import type { AIProviderId } from "./provider";
import type { AIErrorCode } from "./errors";

export const AI_USAGE_FEATURES = ["suggested_replies"] as const;

export type AIUsageFeature = (typeof AI_USAGE_FEATURES)[number];

export const AI_USAGE_STATUSES = [
  "success",
  "error",
  "rate_limited",
  "timeout",
  "cancelled",
] as const;

export type AIUsageStatus = (typeof AI_USAGE_STATUSES)[number];

/**
 * Telemetry for billing/analytics.
 * Never includes full prompts or conversation content.
 */
export type AIUsageEvent = {
  workspaceId: string;
  memberId: string | null;
  feature: AIUsageFeature;
  provider: AIProviderId;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  status: AIUsageStatus;
  errorCode: AIErrorCode | null;
  createdAt: string;
};

export type AIUsageEventInsert = Omit<AIUsageEvent, "createdAt"> & {
  createdAt?: string;
};
