import { describe, expect, it } from "vitest";

import { createSuggestionRequestGuard } from "./suggestion-request-guard";

describe("createSuggestionRequestGuard", () => {
  it("ignores stale success after regenerate starts a newer request", () => {
    const guard = createSuggestionRequestGuard();
    const first = guard.begin("conv-a");
    const second = guard.begin("conv-a");

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("ignores stale error after a newer request begins", () => {
    const guard = createSuggestionRequestGuard();
    const first = guard.begin("conv-a");
    guard.begin("conv-a");

    expect(guard.isCurrent(first)).toBe(false);
  });

  it("invalidates in-flight identity on conversation switch", () => {
    const guard = createSuggestionRequestGuard();
    const first = guard.begin("conv-a");
    guard.resetConversation("conv-b");

    expect(guard.isCurrent(first)).toBe(false);
    const second = guard.begin("conv-b");
    expect(guard.isCurrent(second)).toBe(true);
    expect(second.conversationId).toBe("conv-b");
  });

  it("ignores results for a previous conversation after switch", () => {
    const guard = createSuggestionRequestGuard();
    const forA = guard.begin("conv-a");
    const forB = guard.begin("conv-b");

    expect(guard.isCurrent(forA)).toBe(false);
    expect(guard.isCurrent(forB)).toBe(true);
  });

  it("invalidate prevents the previous token from mutating UI", () => {
    const guard = createSuggestionRequestGuard();
    const token = guard.begin("conv-a");
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("keeps the current request identity valid until replaced", () => {
    const guard = createSuggestionRequestGuard();
    const token = guard.begin("conv-a");
    expect(guard.isCurrent(token)).toBe(true);
    expect(guard.current()).toEqual(token);
  });
});
