import { describe, expect, it } from "vitest";

import {
  AI_ERROR_CODES,
  AI_PROVIDER_IDS,
  suggestedReplyRequestSchema,
  suggestedReplyStreamEventSchema,
} from "./ai";

describe("suggestedReplyRequestSchema", () => {
  it("accepts a valid suggested reply request", () => {
    const parsed = suggestedReplyRequestSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      regenerate: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects client regenerate nonce strings", () => {
    const parsed = suggestedReplyRequestSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      regenerateNonce: "abc123",
    });
    expect(parsed.success).toBe(false);
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

describe("suggestedReplyStreamEventSchema", () => {
  it("accepts cancelled events and bounds error messages", () => {
    expect(suggestedReplyStreamEventSchema.safeParse({ type: "cancelled" }).success).toBe(true);

    expect(
      suggestedReplyStreamEventSchema.safeParse({
        type: "error",
        code: "AI_CANCELLED",
        message: "x".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("keeps provider ids aligned with the shared constant", () => {
    expect(AI_PROVIDER_IDS).toContain("openai");
    expect(AI_PROVIDER_IDS).toContain("mock");
    expect(AI_ERROR_CODES).toContain("AI_CANCELLED");
  });
});
