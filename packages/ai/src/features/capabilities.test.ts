import { describe, expect, it } from "vitest";

import { AI_CAPABILITIES, isCapabilityEnabled, resolveAIFeatureFlags } from "./capabilities";
import { parseWorkspaceAIConfig } from "../types/config";

describe("AI feature capabilities", () => {
  it("is disabled by default", () => {
    const flags = resolveAIFeatureFlags({});
    expect(flags.enabled).toBe(false);
    expect(flags.suggestedReplies).toBe(false);
    expect(isCapabilityEnabled(flags, AI_CAPABILITIES.suggestedReplies)).toBe(false);
  });

  it("requires both ai.enabled and suggestedReplies", () => {
    expect(
      resolveAIFeatureFlags({
        enabled: true,
        features: { suggestedReplies: false },
      }).suggestedReplies,
    ).toBe(false);

    expect(
      resolveAIFeatureFlags({
        enabled: true,
        features: { suggestedReplies: true },
      }).suggestedReplies,
    ).toBe(true);
  });

  it("parses workspace config fail-closed on invalid input", () => {
    expect(parseWorkspaceAIConfig(null).enabled).toBe(false);
    expect(parseWorkspaceAIConfig({ enabled: "yes" }).enabled).toBe(false);
    expect(
      parseWorkspaceAIConfig({
        enabled: true,
        features: { suggestedReplies: true },
        provider: "mock",
        model: "mock-suggested-reply",
      }),
    ).toMatchObject({
      enabled: true,
      provider: "mock",
      features: { suggestedReplies: true },
    });
  });
});
