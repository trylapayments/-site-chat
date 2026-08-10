import "server-only";

import { hashRateLimitKey } from "@/lib/widget/rate-limit";

export const AI_RATE_LIMITS = {
  suggestedReplies: { windowSeconds: 60, limit: 20 },
} as const;

export function hashSuggestedReplyRateLimitKey(input: {
  workspaceId: string;
  memberId: string;
}): string {
  return hashRateLimitKey(
    "ai-suggested-replies",
    `${input.workspaceId}:${input.memberId}`,
  );
}
