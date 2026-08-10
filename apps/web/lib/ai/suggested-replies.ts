import "server-only";

import {
  AIError,
  buildConversationContext,
  buildPrompt,
  buildUsageEvent,
  createAIProvider,
  sanitizePlainText,
  statusFromError,
  type AIProvider,
  type AIProviderId,
  type AIUsageEventInsert,
  type GenerateResult,
  type TokenUsage,
} from "@site-chat/ai";

import { loadWorkspaceAIConfig } from "@/lib/ai/config";
import {
  AI_RATE_LIMITS,
  hashSuggestedReplyRateLimitKey,
} from "@/lib/ai/rate-limit";
import { recordAIUsageEvent } from "@/lib/ai/usage";
import { env } from "@/lib/env.server";
import { fetchConversation, fetchMessages } from "@/lib/inbox/queries";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type SuggestedReplyAuthContext = {
  workspaceId: string;
  workspaceName: string;
  memberId: string;
  operatorDisplayName: string | null;
  conversationId: string;
  regenerateNonce?: string;
};

export type SuggestedReplyStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      suggestion: string;
      model: string;
      provider: AIProviderId;
      usage: TokenUsage;
    };

async function consumeSuggestedReplyRateLimit(input: {
  workspaceId: string;
  memberId: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const bucketKey = hashSuggestedReplyRateLimitKey(input);
  const { data, error } = await supabase.rpc("ai_consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_window_seconds: AI_RATE_LIMITS.suggestedReplies.windowSeconds,
    p_limit: AI_RATE_LIMITS.suggestedReplies.limit,
  });

  if (error) {
    throw new AIError("AI_UNAVAILABLE", "Rate limit check failed.", {
      cause: error,
    });
  }

  if (!data) {
    throw new AIError(
      "AI_RATE_LIMITED",
      "Suggested reply rate limit exceeded.",
    );
  }
}

function createWorkspaceProvider(
  providerId: AIProviderId,
  model?: string,
): AIProvider {
  return createAIProvider({
    provider: providerId,
    model,
    credentials: {
      openaiApiKey: env.OPENAI_API_KEY,
    },
    openai: {
      defaultTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    },
  });
}

async function loadAuthorizedContext(
  supabase: AppSupabaseClient,
  auth: SuggestedReplyAuthContext,
) {
  const { config, flags } = await loadWorkspaceAIConfig(
    supabase,
    auth.workspaceId,
  );

  if (!flags.enabled) {
    throw new AIError("AI_DISABLED", "AI is disabled for this workspace.");
  }

  if (!flags.suggestedReplies) {
    throw new AIError(
      "AI_DISABLED",
      "Suggested replies are disabled for this workspace.",
    );
  }

  await consumeSuggestedReplyRateLimit({
    workspaceId: auth.workspaceId,
    memberId: auth.memberId,
  });

  let conversation;
  try {
    conversation = await fetchConversation(
      supabase,
      auth.workspaceId,
      auth.conversationId,
    );
  } catch {
    throw new AIError("AI_UNAVAILABLE", "Conversation not found.", {
      status: 404,
      retryable: false,
    });
  }

  const messages = await fetchMessages(
    supabase,
    auth.workspaceId,
    auth.conversationId,
    { limit: 50 },
  );

  const context = buildConversationContext({
    workspace: {
      id: auth.workspaceId,
      name: auth.workspaceName,
    },
    operator: {
      id: auth.memberId,
      displayName: auth.operatorDisplayName,
    },
    visitor: {
      displayName: conversation.contact?.name ?? null,
    },
    messages: messages.items.map((message) => ({
      id: message.id,
      sequenceNumber: message.sequence_number,
      senderType: message.sender_type,
      body: message.body,
      createdAt: message.created_at,
    })),
  });

  const prompt = buildPrompt("suggested_reply", context);
  if (auth.regenerateNonce) {
    const last = prompt.messages.at(-1);
    if (last?.role === "user") {
      last.content = `${last.content}\n\n[regenerate:${auth.regenerateNonce}]`;
    }
  }

  const provider = createWorkspaceProvider(config.provider, config.model);

  return { provider, prompt, config };
}

async function persistUsage(event: AIUsageEventInsert): Promise<void> {
  await recordAIUsageEvent(event);
}

export async function generateSuggestedReply(
  supabase: AppSupabaseClient,
  auth: SuggestedReplyAuthContext,
  options?: { signal?: AbortSignal },
): Promise<GenerateResult & { provider: AIProviderId }> {
  const started = Date.now();
  let providerId: AIProviderId = "mock";
  let model: string | null = null;

  try {
    const { provider, prompt, config } = await loadAuthorizedContext(
      supabase,
      auth,
    );
    providerId = provider.id;
    model = config.model ?? provider.metadata.model;

    const result = await provider.generate(
      {
        messages: prompt.messages,
        model: config.model,
        temperature: prompt.temperature,
        maxOutputTokens: prompt.maxOutputTokens,
      },
      {
        signal: options?.signal,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      },
    );

    const suggestion = sanitizePlainText(result.text);
    if (!suggestion) {
      throw new AIError(
        "AI_INVALID_RESPONSE",
        "Provider returned empty suggestion text.",
      );
    }

    await persistUsage(
      buildUsageEvent({
        workspaceId: auth.workspaceId,
        memberId: auth.memberId,
        feature: "suggested_replies",
        provider: provider.id,
        model: result.model,
        usage: result.usage,
        latencyMs: Date.now() - started,
        status: "success",
      }),
    );

    return {
      ...result,
      text: suggestion,
      provider: provider.id,
    };
  } catch (error) {
    const mapped = statusFromError(error);
    await persistUsage(
      buildUsageEvent({
        workspaceId: auth.workspaceId,
        memberId: auth.memberId,
        feature: "suggested_replies",
        provider: providerId,
        model,
        latencyMs: Date.now() - started,
        status: mapped.status,
        errorCode: mapped.errorCode,
      }),
    );
    throw error;
  }
}

export async function* streamSuggestedReply(
  supabase: AppSupabaseClient,
  auth: SuggestedReplyAuthContext,
  options?: { signal?: AbortSignal },
): AsyncGenerator<SuggestedReplyStreamEvent, void, unknown> {
  const started = Date.now();
  let providerId: AIProviderId = "mock";
  let model: string | null = null;
  let completed = false;

  try {
    const { provider, prompt, config } = await loadAuthorizedContext(
      supabase,
      auth,
    );
    providerId = provider.id;
    model = config.model ?? provider.metadata.model;

    for await (const chunk of provider.stream(
      {
        messages: prompt.messages,
        model: config.model,
        temperature: prompt.temperature,
        maxOutputTokens: prompt.maxOutputTokens,
      },
      {
        signal: options?.signal,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      },
    )) {
      if (chunk.type === "delta") {
        yield { type: "delta", text: chunk.text };
        continue;
      }

      const suggestion = sanitizePlainText(chunk.text);
      if (!suggestion) {
        throw new AIError(
          "AI_INVALID_RESPONSE",
          "Provider returned empty suggestion text.",
        );
      }

      model = chunk.model;
      completed = true;

      await persistUsage(
        buildUsageEvent({
          workspaceId: auth.workspaceId,
          memberId: auth.memberId,
          feature: "suggested_replies",
          provider: provider.id,
          model: chunk.model,
          usage: chunk.usage,
          latencyMs: Date.now() - started,
          status: "success",
        }),
      );

      yield {
        type: "done",
        suggestion,
        model: chunk.model,
        provider: provider.id,
        usage: chunk.usage,
      };
    }

    if (!completed) {
      throw new AIError(
        "AI_INVALID_RESPONSE",
        "Stream ended without a completion chunk.",
      );
    }
  } catch (error) {
    if (!completed) {
      const mapped = statusFromError(error);
      await persistUsage(
        buildUsageEvent({
          workspaceId: auth.workspaceId,
          memberId: auth.memberId,
          feature: "suggested_replies",
          provider: providerId,
          model,
          latencyMs: Date.now() - started,
          status: mapped.status,
          errorCode: mapped.errorCode,
        }),
      );
    }
    throw error;
  }
}
