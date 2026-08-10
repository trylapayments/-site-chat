import "server-only";

import type { AIUsageEventInsert } from "@site-chat/ai";

import { createServiceClient } from "@/lib/supabase/service";

export async function recordAIUsageEvent(
  event: AIUsageEventInsert,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("ai_usage_events").insert({
    workspace_id: event.workspaceId,
    member_id: event.memberId,
    feature: event.feature,
    provider: event.provider,
    model: event.model,
    prompt_tokens: event.promptTokens,
    completion_tokens: event.completionTokens,
    total_tokens: event.totalTokens,
    latency_ms: event.latencyMs,
    status: event.status,
    error_code: event.errorCode,
  });

  if (error) {
    // Telemetry must not break the operator flow.
    console.error("Failed to record AI usage event", {
      workspaceId: event.workspaceId,
      feature: event.feature,
      status: event.status,
      code: error.code,
    });
  }
}
