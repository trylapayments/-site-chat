import type { AIErrorCode } from "../types/errors";
import { isAIError } from "../types/errors";
import type { AIProviderId, TokenUsage } from "../types/provider";
import type { AIUsageEventInsert, AIUsageFeature, AIUsageStatus } from "../types/telemetry";

export function statusFromError(error: unknown): {
  status: AIUsageStatus;
  errorCode: AIErrorCode | null;
} {
  if (!isAIError(error)) {
    return { status: "error", errorCode: "AI_UNAVAILABLE" };
  }

  switch (error.code) {
    case "AI_RATE_LIMITED":
      return { status: "rate_limited", errorCode: error.code };
    case "AI_TIMEOUT":
      return { status: "timeout", errorCode: error.code };
    default:
      return { status: "error", errorCode: error.code };
  }
}

export function buildUsageEvent(input: {
  workspaceId: string;
  memberId: string | null;
  feature: AIUsageFeature;
  provider: AIProviderId;
  model: string | null;
  usage?: TokenUsage | null;
  latencyMs: number;
  status: AIUsageStatus;
  errorCode?: AIErrorCode | null;
}): AIUsageEventInsert {
  return {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    promptTokens: input.usage?.promptTokens ?? null,
    completionTokens: input.usage?.completionTokens ?? null,
    totalTokens: input.usage?.totalTokens ?? null,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    status: input.status,
    errorCode: input.errorCode ?? null,
  };
}
