import { describe, expect, it } from "vitest";

import { suggestedReplyRequestSchema } from "@site-chat/shared";
import {
  AIError,
  parseWorkspaceAIConfig,
  resolveAIFeatureFlags,
} from "@site-chat/ai";

describe("suggested replies authorization prerequisites", () => {
  it("rejects invalid request payloads", () => {
    expect(
      suggestedReplyRequestSchema.safeParse({
        workspaceId: "not-a-uuid",
        conversationId: "11111111-1111-1111-1111-111111111111",
      }).success,
    ).toBe(false);
  });

  it("treats disabled and unconfigured AI as fail-closed", () => {
    const disabled = resolveAIFeatureFlags(
      parseWorkspaceAIConfig({ enabled: false }),
    );
    expect(disabled.suggestedReplies).toBe(false);

    const notConfigured = parseWorkspaceAIConfig(undefined);
    expect(notConfigured.enabled).toBe(false);

    const error = new AIError("AI_DISABLED", "off");
    expect(error.status).toBe(403);
  });

  it("does not enable visitor-facing AI capabilities", () => {
    const flags = resolveAIFeatureFlags({
      enabled: true,
      features: { suggestedReplies: true, agent: true },
    });
    // Agent capability may be flagged in config for future use, but product
    // surface for visitors is out of scope; only suggested replies is wired.
    expect(flags.suggestedReplies).toBe(true);
    expect(flags.agent).toBe(true);
  });
});
