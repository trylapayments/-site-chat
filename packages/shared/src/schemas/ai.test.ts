import { describe, expect, it } from "vitest";

import { suggestedReplyRequestSchema } from "./ai";

describe("suggestedReplyRequestSchema", () => {
  it("accepts a valid suggested reply request", () => {
    const parsed = suggestedReplyRequestSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      regenerateNonce: "abc123",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unexpected fields", () => {
    const parsed = suggestedReplyRequestSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      prompt: "should not be allowed",
    });
    expect(parsed.success).toBe(false);
  });
});
