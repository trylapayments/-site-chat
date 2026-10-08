import { describe, expect, it } from "vitest";

import {
  AI_RATE_LIMITS,
  hashSuggestedReplyRateLimitKey,
} from "@/lib/ai/rate-limit";

describe("AI rate limit helpers", () => {
  it("scopes suggested reply buckets by workspace and member", () => {
    const a = hashSuggestedReplyRateLimitKey({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      memberId: "22222222-2222-2222-2222-222222222222",
    });
    const b = hashSuggestedReplyRateLimitKey({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      memberId: "33333333-3333-3333-3333-333333333333",
    });
    const c = hashSuggestedReplyRateLimitKey({
      workspaceId: "44444444-4444-4444-4444-444444444444",
      memberId: "22222222-2222-2222-2222-222222222222",
    });

    expect(a).toHaveLength(64);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(AI_RATE_LIMITS.suggestedReplies.limit).toBeGreaterThan(0);
  });
});
