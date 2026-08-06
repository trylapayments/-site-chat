import { describe, expect, it } from "vitest";

import {
  TYPING_REMOTE_TTL_MS,
  applyRemoteTypingEvent,
  buildPresenceStatePayload,
  buildTypingBroadcastPayload,
  decideLocalTypingEmit,
  expireRemoteTypingActors,
  isAnyoneTyping,
  isRoleOnline,
  isSafePublicDisplayName,
  operatorEphemeralActorKey,
  parsePresenceStatePayload,
  parseTypingBroadcastPayload,
  reconcilePresencePeers,
  resolveTypingDisplayName,
  sanitizePublicDisplayName,
} from "./ephemeral.js";

describe("typing broadcast schema", () => {
  it("accepts a valid started payload", () => {
    const parsed = parseTypingBroadcastPayload({
      v: 1,
      actorRole: "visitor",
      actorKey: "wr_abc123",
      state: "started",
      displayName: null,
    });

    expect(parsed).toEqual({
      v: 1,
      actorRole: "visitor",
      actorKey: "wr_abc123",
      state: "started",
      displayName: null,
    });
  });

  it("rejects malformed and unknown payloads", () => {
    expect(parseTypingBroadcastPayload(null)).toBeNull();
    expect(parseTypingBroadcastPayload({})).toBeNull();
    expect(
      parseTypingBroadcastPayload({
        v: 2,
        actorRole: "visitor",
        actorKey: "wr_abc",
        state: "started",
      }),
    ).toBeNull();
    expect(
      parseTypingBroadcastPayload({
        v: 1,
        actorRole: "visitor",
        actorKey: "wr_abc",
        state: "started",
        extra: true,
      }),
    ).toBeNull();
    expect(
      parseTypingBroadcastPayload({
        v: 1,
        actorRole: "bot",
        actorKey: "x",
        state: "started",
      }),
    ).toBeNull();
  });
});

describe("presence payload schema", () => {
  it("accepts valid presence state", () => {
    expect(
      parsePresenceStatePayload({
        v: 1,
        role: "operator",
        displayName: "Alex",
      }),
    ).toEqual({
      v: 1,
      role: "operator",
      displayName: "Alex",
    });
  });

  it("rejects malformed presence payloads", () => {
    expect(parsePresenceStatePayload({ v: 1, role: "visitor", hack: 1 })).toBeNull();
    expect(parsePresenceStatePayload({ role: "visitor" })).toBeNull();
  });
});

describe("display name safety", () => {
  it("rejects emails and empty values", () => {
    expect(isSafePublicDisplayName("owner@local.test")).toBe(false);
    expect(isSafePublicDisplayName("")).toBe(false);
    expect(isSafePublicDisplayName(null)).toBe(false);
    expect(sanitizePublicDisplayName("  Alex  ")).toBe("Alex");
  });
});

describe("typing expiry and multi-actor reconciliation", () => {
  it("tracks started actors and expires them after TTL", () => {
    const started = applyRemoteTypingEvent({
      actors: new Map(),
      payload: buildTypingBroadcastPayload({
        actorRole: "operator",
        actorKey: "op_a",
        state: "started",
        displayName: "Alex",
      }),
      nowMs: 1_000,
    });

    expect(isAnyoneTyping(started, "operator")).toBe(true);
    expect(resolveTypingDisplayName(started, "operator")).toBe("Alex");

    const expired = expireRemoteTypingActors({
      actors: started,
      nowMs: 1_000 + TYPING_REMOTE_TTL_MS + 1,
    });

    expect(expired.changed).toBe(true);
    expect(isAnyoneTyping(expired.actors, "operator")).toBe(false);
  });

  it("clears on stopped and ignores local echo", () => {
    const withActor = applyRemoteTypingEvent({
      actors: new Map(),
      payload: buildTypingBroadcastPayload({
        actorRole: "visitor",
        actorKey: "wr_1",
        state: "started",
      }),
      nowMs: 0,
    });

    const stopped = applyRemoteTypingEvent({
      actors: withActor,
      payload: buildTypingBroadcastPayload({
        actorRole: "visitor",
        actorKey: "wr_1",
        state: "stopped",
      }),
      nowMs: 10,
    });
    expect(stopped.size).toBe(0);

    const echo = applyRemoteTypingEvent({
      actors: new Map(),
      payload: buildTypingBroadcastPayload({
        actorRole: "visitor",
        actorKey: "wr_me",
        state: "started",
      }),
      nowMs: 0,
      localActorKey: "wr_me",
    });
    expect(echo.size).toBe(0);
  });

  it("uses generic label when multiple distinct operator names are typing", () => {
    let actors = applyRemoteTypingEvent({
      actors: new Map(),
      payload: buildTypingBroadcastPayload({
        actorRole: "operator",
        actorKey: "op_1",
        state: "started",
        displayName: "Alex",
      }),
      nowMs: 0,
    });
    actors = applyRemoteTypingEvent({
      actors,
      payload: buildTypingBroadcastPayload({
        actorRole: "operator",
        actorKey: "op_2",
        state: "started",
        displayName: "Sam",
      }),
      nowMs: 1,
    });

    expect(isAnyoneTyping(actors, "operator")).toBe(true);
    expect(resolveTypingDisplayName(actors, "operator")).toBeNull();
  });
});

describe("local typing throttle decisions", () => {
  it("starts after meaningful input, not empty focus", () => {
    expect(
      decideLocalTypingEmit({
        text: "",
        nowMs: 0,
        lastStartedAt: null,
        isCurrentlyTyping: false,
      }),
    ).toEqual({ action: "none" });

    expect(
      decideLocalTypingEmit({
        text: "hi",
        nowMs: 0,
        lastStartedAt: null,
        isCurrentlyTyping: false,
      }),
    ).toEqual({ action: "started" });
  });

  it("throttles repeated started events and stops on clear", () => {
    expect(
      decideLocalTypingEmit({
        text: "hi",
        nowMs: 500,
        lastStartedAt: 0,
        isCurrentlyTyping: true,
        throttleMs: 1500,
      }),
    ).toEqual({ action: "none" });

    expect(
      decideLocalTypingEmit({
        text: "hi",
        nowMs: 1600,
        lastStartedAt: 0,
        isCurrentlyTyping: true,
        throttleMs: 1500,
      }),
    ).toEqual({ action: "started" });

    expect(
      decideLocalTypingEmit({
        text: "   ",
        nowMs: 2000,
        lastStartedAt: 1600,
        isCurrentlyTyping: true,
      }),
    ).toEqual({ action: "stopped" });
  });
});

describe("presence multi-tab reconciliation", () => {
  it("keeps a peer online while any tab meta remains", () => {
    const peers = reconcilePresencePeers({
      wr_visitor: [
        buildPresenceStatePayload({ role: "visitor" }),
        buildPresenceStatePayload({ role: "visitor" }),
      ],
      op_agent: [buildPresenceStatePayload({ role: "operator", displayName: "Alex" })],
    });

    expect(peers.find((p) => p.key === "wr_visitor")?.connectionCount).toBe(2);
    expect(isRoleOnline(peers, "visitor")).toBe(true);
    expect(isRoleOnline(peers, "operator")).toBe(true);
    expect(isRoleOnline(peers, "operator", "op_agent")).toBe(false);
  });

  it("ignores malformed presence metas", () => {
    const peers = reconcilePresencePeers({
      bad: [{ foo: "bar" }],
      good: [buildPresenceStatePayload({ role: "visitor" })],
    });

    expect(peers).toHaveLength(1);
    expect(peers[0]?.key).toBe("good");
  });

  it("produces stable opaque operator keys", () => {
    const a = operatorEphemeralActorKey("11111111-1111-1111-1111-111111111111");
    const b = operatorEphemeralActorKey("11111111-1111-1111-1111-111111111111");
    const c = operatorEphemeralActorKey("22222222-2222-2222-2222-222222222222");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("op_")).toBe(true);
    expect(a.includes("11111111")).toBe(false);
  });
});
