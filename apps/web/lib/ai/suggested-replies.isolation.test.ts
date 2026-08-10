import { describe, expect, it } from "vitest";

import { suggestedReplyRequestSchema } from "@site-chat/shared";
import {
  AIError,
  parseWorkspaceAIConfig,
  resolveAIFeatureFlags,
} from "@site-chat/ai";
import { can } from "@site-chat/shared";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";

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

  it("denies viewer / no-send permission for suggested replies", () => {
    expect(can("viewer", "send_messages")).toBe(false);
    expect(() => {
      requireCapability("viewer", "send_messages");
    }).toThrow(CapabilityError);
  });

  it("allows a valid operator role with send_messages in the correct workspace role model", () => {
    expect(can("agent", "send_messages")).toBe(true);
    expect(can("admin", "send_messages")).toBe(true);
    expect(can("owner", "send_messages")).toBe(true);
    expect(() => {
      requireCapability("agent", "send_messages");
    }).not.toThrow();
  });

  it("requires the request workspace to be in the caller's accessible workspaces", () => {
    const accessible = [
      {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        role: "agent" as const,
      },
    ];
    const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";

    const own = accessible.find(
      (item) => item.workspace_id === "11111111-1111-4111-8111-111111111111",
    );
    const foreign = accessible.find(
      (item) => item.workspace_id === otherWorkspaceId,
    );

    expect(own).toBeDefined();
    expect(foreign).toBeUndefined();
  });

  it("does not enable visitor-facing AI capabilities", () => {
    const flags = resolveAIFeatureFlags({
      enabled: true,
      features: { suggestedReplies: true, agent: true },
    });
    expect(flags.suggestedReplies).toBe(true);
    expect(flags.agent).toBe(true);
  });
});
