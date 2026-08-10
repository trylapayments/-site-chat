import { describe, expect, it } from "vitest";

import { AIError } from "../types/errors";
import { buildUsageEvent, statusFromError } from "./usage";

describe("AI usage telemetry", () => {
  it("records token fields and allows null usage", () => {
    const event = buildUsageEvent({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      memberId: null,
      feature: "suggested_replies",
      provider: "mock",
      model: "mock-suggested-reply",
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      latencyMs: 12.6,
      status: "success",
    });

    expect(event.latencyMs).toBe(13);
    expect(event.promptTokens).toBeNull();
    expect(JSON.stringify(event)).not.toContain("Conversation");
    expect(JSON.stringify(event)).not.toContain("system prompt");
  });

  it("maps errors to usage status codes", () => {
    expect(statusFromError(new AIError("AI_RATE_LIMITED", "slow"))).toEqual({
      status: "rate_limited",
      errorCode: "AI_RATE_LIMITED",
    });
    expect(statusFromError(new AIError("AI_TIMEOUT", "late"))).toEqual({
      status: "timeout",
      errorCode: "AI_TIMEOUT",
    });
  });
});
