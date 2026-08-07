import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TYPING_BROADCAST_EVENT,
  TYPING_IDLE_STOP_MS,
  TYPING_THROTTLE_MS,
  buildTypingBroadcastPayload,
  decideLocalTypingEmit,
} from "@site-chat/shared";

describe("widget typing emit policy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start typing on empty focus-equivalent input", () => {
    expect(
      decideLocalTypingEmit({
        text: "",
        nowMs: 0,
        lastStartedAt: null,
        isCurrentlyTyping: false,
      }),
    ).toEqual({ action: "none" });
  });

  it("throttles started broadcasts", () => {
    const first = decideLocalTypingEmit({
      text: "hello",
      nowMs: 0,
      lastStartedAt: null,
      isCurrentlyTyping: false,
      throttleMs: TYPING_THROTTLE_MS,
    });
    expect(first).toEqual({ action: "started" });

    const throttled = decideLocalTypingEmit({
      text: "hello!",
      nowMs: TYPING_THROTTLE_MS - 1,
      lastStartedAt: 0,
      isCurrentlyTyping: true,
      throttleMs: TYPING_THROTTLE_MS,
    });
    expect(throttled).toEqual({ action: "none" });
  });

  it("stops after composer clear (send path)", () => {
    expect(
      decideLocalTypingEmit({
        text: "",
        nowMs: 5_000,
        lastStartedAt: 4_000,
        isCurrentlyTyping: true,
      }),
    ).toEqual({ action: "stopped" });
  });

  it("idle stop window matches shared constant", () => {
    expect(TYPING_IDLE_STOP_MS).toBeGreaterThanOrEqual(1_500);
    expect(TYPING_IDLE_STOP_MS).toBeLessThanOrEqual(3_000);
  });

  it("builds visitor typing payloads for broadcast event", () => {
    const payload = buildTypingBroadcastPayload({
      actorRole: "visitor",
      actorKey: "wr_test",
      state: "started",
    });
    expect(payload.v).toBe(1);
    expect(TYPING_BROADCAST_EVENT).toBe("typing.v1");
  });
});

describe("RTL typing chrome", () => {
  it("Hebrew agentTyping keeps {{name}} placeholder", async () => {
    const { loadWidgetDictionary } = await import("../i18n/load-dictionary");
    const he = await loadWidgetDictionary("he");
    expect(he.agentTyping).toContain("{{name}}");
    expect(he.online.length).toBeGreaterThan(0);
    expect(he.offline.length).toBeGreaterThan(0);
  });
});
