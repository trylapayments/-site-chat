import { describe, expect, it, vi } from "vitest";

import {
  applyRemoteTypingEvent,
  buildTypingBroadcastPayload,
  expireRemoteTypingActors,
  isAnyoneTyping,
  operatorEphemeralActorKey,
  reconcilePresencePeers,
  buildPresenceStatePayload,
  isRoleOnline,
  TYPING_REMOTE_TTL_MS,
} from "@site-chat/shared";

/**
 * Operator ephemeral reconciliation (pure) — mirrors LiveConversationThread
 * switching conversations / clearing stale typing + presence.
 */
describe("operator ephemeral reconciliation", () => {
  it("shows visitor typing and clears on stop/expiry", () => {
    let actors = applyRemoteTypingEvent({
      actors: new Map(),
      payload: buildTypingBroadcastPayload({
        actorRole: "visitor",
        actorKey: "wr_1",
        state: "started",
      }),
      nowMs: 0,
    });
    expect(isAnyoneTyping(actors, "visitor")).toBe(true);

    actors = applyRemoteTypingEvent({
      actors,
      payload: buildTypingBroadcastPayload({
        actorRole: "visitor",
        actorKey: "wr_1",
        state: "stopped",
      }),
      nowMs: 10,
    });
    expect(isAnyoneTyping(actors, "visitor")).toBe(false);
  });

  it("expires stale visitor typing automatically", () => {
    const actors = applyRemoteTypingEvent({
      actors: new Map(),
      payload: buildTypingBroadcastPayload({
        actorRole: "visitor",
        actorKey: "wr_1",
        state: "started",
      }),
      nowMs: 100,
    });

    const expired = expireRemoteTypingActors({
      actors,
      nowMs: 100 + TYPING_REMOTE_TTL_MS + 1,
    });
    expect(expired.changed).toBe(true);
    expect(isAnyoneTyping(expired.actors, "visitor")).toBe(false);
  });

  it("clears presence when switching conversations (empty state)", () => {
    const online = reconcilePresencePeers({
      wr_1: [buildPresenceStatePayload({ role: "visitor" })],
    });
    expect(isRoleOnline(online, "visitor")).toBe(true);

    const cleared = reconcilePresencePeers({});
    expect(isRoleOnline(cleared, "visitor")).toBe(false);
  });

  it("uses opaque operator actor keys", () => {
    const key = operatorEphemeralActorKey(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(key.startsWith("op_")).toBe(true);
    expect(key.includes("aaaaaaaa")).toBe(false);
  });

  it("does not infinite-loop on identical presence snapshots", () => {
    const spy = vi.fn();
    let previousOnline = false;

    function applyPresence(state: Record<string, unknown[]>) {
      const peers = reconcilePresencePeers(state);
      const online = isRoleOnline(peers, "visitor");
      if (online !== previousOnline) {
        previousOnline = online;
        spy(online);
      }
    }

    const state = {
      wr_1: [buildPresenceStatePayload({ role: "visitor" })],
    };
    applyPresence(state);
    applyPresence(state);
    applyPresence(state);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true);
  });
});
