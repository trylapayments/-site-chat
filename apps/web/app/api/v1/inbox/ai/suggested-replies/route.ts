import { toPublicAIError } from "@site-chat/ai";
import { suggestedReplyRequestSchema } from "@site-chat/shared";
import { NextResponse } from "next/server";

import { aiJsonError, encodeSseEvent } from "@/lib/ai/responses";
import { streamSuggestedReply } from "@/lib/ai/suggested-replies";
import { requireUser } from "@/lib/auth/session";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user } = await requireUser(supabase);
    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "AI_UNAVAILABLE",
            message: "Authentication required.",
            retryable: false,
          },
        },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "AI_INVALID_RESPONSE",
            message: "Invalid request body.",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    const parsed = suggestedReplyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "AI_INVALID_RESPONSE",
            message: "Invalid request.",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    const { membership } = await getWorkspaceContext();
    const workspace = membership.accessible_workspaces.find(
      (item) => item.workspace_id === parsed.data.workspaceId,
    );

    if (!workspace) {
      return NextResponse.json(
        {
          error: {
            code: "AI_UNAVAILABLE",
            message: "Forbidden.",
            retryable: false,
          },
        },
        { status: 403 },
      );
    }

    try {
      requireCapability(workspace.role, "send_messages");
    } catch (error) {
      if (error instanceof CapabilityError) {
        return NextResponse.json(
          {
            error: {
              code: "AI_UNAVAILABLE",
              message: "Forbidden.",
              retryable: false,
            },
          },
          { status: 403 },
        );
      }
      throw error;
    }

    const { data: memberRow } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspace.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();

    if (!memberRow?.id) {
      return NextResponse.json(
        {
          error: {
            code: "AI_UNAVAILABLE",
            message: "Forbidden.",
            retryable: false,
          },
        },
        { status: 403 },
      );
    }

    const auth = {
      workspaceId: workspace.workspace_id,
      workspaceName: workspace.name,
      memberId: memberRow.id,
      operatorDisplayName: user.email ?? null,
      conversationId: parsed.data.conversationId,
      regenerateNonce: parsed.data.regenerateNonce,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of streamSuggestedReply(supabase, auth, {
            signal: request.signal,
          })) {
            if (chunk.type === "delta") {
              controller.enqueue(
                encoder.encode(
                  encodeSseEvent({ type: "delta", text: chunk.text }),
                ),
              );
              continue;
            }

            controller.enqueue(
              encoder.encode(
                encodeSseEvent({
                  type: "done",
                  suggestion: chunk.suggestion,
                  model: chunk.model,
                  provider: chunk.provider,
                  usage: {
                    promptTokens: chunk.usage.promptTokens,
                    completionTokens: chunk.usage.completionTokens,
                    totalTokens: chunk.usage.totalTokens,
                  },
                }),
              ),
            );
          }
        } catch (error) {
          const publicError = toPublicAIError(error);
          controller.enqueue(
            encoder.encode(
              encodeSseEvent({
                type: "error",
                code: publicError.code,
                message: publicError.message,
              }),
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return aiJsonError(error);
  }
}
