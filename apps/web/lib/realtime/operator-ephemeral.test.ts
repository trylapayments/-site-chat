import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyRemoteTypingEvent,
  buildPresenceStatePayload,
  buildTypingBroadcastPayload,
  expireRemoteTypingActors,
  isAnyoneTyping,
  isRoleOnline,
  operatorEphemeralActorKey,
  reconcilePresencePeers,
  TYPING_REMOTE_TTL_MS,
} from "@site-chat/shared";

import {
  channelMatchesEphemeralTopic,
  channelRejectsPresenceCallbacks,
  subscribeOperatorConversationEphemeral,
} from "./operator-ephemeral";

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

describe("channelRejectsPresenceCallbacks / topic matching", () => {
  it("rejects presence when joining, joined, or joinedOnce", () => {
    expect(
      channelRejectsPresenceCallbacks({ state: "joining", joinedOnce: false }),
    ).toBe(true);
    expect(
      channelRejectsPresenceCallbacks({ state: "joined", joinedOnce: false }),
    ).toBe(true);
    expect(
      channelRejectsPresenceCallbacks({ state: "closed", joinedOnce: true }),
    ).toBe(true);
    expect(
      channelRejectsPresenceCallbacks({ state: "closed", joinedOnce: false }),
    ).toBe(false);
  });

  it("matches realtime-prefixed and bare ephemeral topics", () => {
    const topic = "widget-ephemeral:abc";
    expect(channelMatchesEphemeralTopic(topic, topic)).toBe(true);
    expect(channelMatchesEphemeralTopic(`realtime:${topic}`, topic)).toBe(true);
    expect(channelMatchesEphemeralTopic("other", topic)).toBe(false);
  });
});

type MockChannelState = "closed" | "joining" | "joined" | "errored";

class MockRealtimeChannel {
  topic: string;
  state: MockChannelState = "closed";
  joinedOnce = false;
  subscribeCount = 0;
  presenceHandlerCount = 0;
  broadcastHandlerCount = 0;
  /** Mirrors @supabase/realtime-js: presence .on after subscribe throws. */
  presenceAfterSubscribeAttempts = 0;
  sendCalls: unknown[] = [];
  private subscribeCallback: ((status: string) => void) | null = null;
  private readonly deferSubscribed: boolean;

  constructor(name: string, options?: { deferSubscribed?: boolean }) {
    this.topic = `realtime:${name}`;
    this.deferSubscribed = options?.deferSubscribed ?? false;
  }

  on(
    type: string,
    _filter: unknown,
    _callback: (...args: unknown[]) => void,
  ): this {
    if (type === "presence") {
      if (
        this.joinedOnce ||
        this.state === "joining" ||
        this.state === "joined"
      ) {
        this.presenceAfterSubscribeAttempts += 1;
        throw new Error(
          `cannot add \`presence\` callbacks for ${this.topic} after \`subscribe()\``,
        );
      }
      this.presenceHandlerCount += 1;
      return this;
    }

    if (type === "broadcast") {
      this.broadcastHandlerCount += 1;
    }
    return this;
  }

  subscribe(callback?: (status: string) => void): this {
    this.subscribeCount += 1;
    this.state = "joining";
    this.joinedOnce = true;
    this.subscribeCallback = callback ?? null;
    if (!this.deferSubscribed) {
      queueMicrotask(() => {
        this.emitSubscribed();
      });
    }
    return this;
  }

  /** Complete a deferred subscribe — used to race same-token auth starts. */
  emitSubscribed(): void {
    this.state = "joined";
    this.subscribeCallback?.("SUBSCRIBED");
  }

  presenceState(): Record<string, unknown[]> {
    return {};
  }

  track(): Promise<"ok"> {
    return Promise.resolve("ok");
  }

  untrack(): Promise<"ok"> {
    return Promise.resolve("ok");
  }

  send(payload: unknown): Promise<"ok"> {
    this.sendCalls.push(payload);
    return Promise.resolve("ok");
  }
}

function createMockSupabase(options?: {
  accessToken?: string;
  /** Return a pre-subscribed channel from channel() to simulate reuse races. */
  preJoinedTopic?: string;
  /** Hold SUBSCRIBED until tests call emitSubscribed(). */
  deferSubscribed?: boolean;
}) {
  const accessToken = options?.accessToken ?? "access-token-1";
  const channels: MockRealtimeChannel[] = [];
  const authListeners: Array<
    (event: string, session: { access_token: string } | null) => void
  > = [];

  if (options?.preJoinedTopic) {
    const stale = new MockRealtimeChannel(options.preJoinedTopic);
    stale.state = "joined";
    stale.joinedOnce = true;
    stale.subscribeCount = 1;
    channels.push(stale);
  }

  const client = {
    getChannels: () => channels,
    removeChannel: vi.fn((channel: MockRealtimeChannel) => {
      const index = channels.indexOf(channel);
      if (index >= 0) {
        channels.splice(index, 1);
      }
      channel.state = "closed";
      return Promise.resolve("ok");
    }),
    channel: vi.fn((name: string) => {
      const existing = channels.find(
        (candidate) =>
          candidate.topic === name || candidate.topic === `realtime:${name}`,
      );
      if (existing) {
        return existing;
      }
      const created = new MockRealtimeChannel(name, {
        deferSubscribed: options?.deferSubscribed,
      });
      channels.push(created);
      return created;
    }),
    realtime: {
      setAuth: vi.fn(() => Promise.resolve(undefined)),
    },
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({
          data: {
            session: { access_token: accessToken },
          },
        }),
      ),
      onAuthStateChange: vi.fn(
        (
          listener: (
            event: string,
            session: { access_token: string } | null,
          ) => void,
        ) => {
          authListeners.push(listener);
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn(),
              },
            },
          };
        },
      ),
    },
    __channels: channels,
    __authListeners: authListeners,
    __setAccessToken(next: string) {
      (client.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { session: { access_token: next } },
      });
    },
  };

  return client;
}

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

describe("subscribeOperatorConversationEphemeral lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    createClientMock.mockReset();
  });

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("registers all presence handlers before subscribe()", async () => {
    const supabase = createMockSupabase();
    createClientMock.mockReturnValue(supabase);

    const controller = subscribeOperatorConversationEphemeral({
      ephemeralTopic: "widget-ephemeral:conv-1",
      memberId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      onVisitorTyping: vi.fn(),
      onVisitorPresence: vi.fn(),
    });

    expect(createClientMock).toHaveBeenCalled();

    await vi.waitFor(
      () => {
        expect(supabase.channel).toHaveBeenCalled();
      },
      { timeout: 1_000 },
    );

    const channel = supabase.__channels[0];
    expect(channel).toBeDefined();
    if (!channel) {
      throw new Error("expected ephemeral channel");
    }
    expect(channel.presenceAfterSubscribeAttempts).toBe(0);
    expect(channel.presenceHandlerCount).toBe(3);
    expect(channel.broadcastHandlerCount).toBe(2);
    expect(channel.subscribeCount).toBe(1);
    expect(channel.joinedOnce).toBe(true);

    controller.unsubscribe();
  });

  it("does not resubscribe or orphan SUBSCRIBED on same-token auth while connecting", async () => {
    const supabase = createMockSupabase({
      accessToken: "token-stable",
      deferSubscribed: true,
    });
    createClientMock.mockReturnValue(supabase);

    const statuses: string[] = [];
    const controller = subscribeOperatorConversationEphemeral({
      ephemeralTopic: "widget-ephemeral:conv-connecting-race",
      memberId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      onVisitorTyping: vi.fn(),
      onVisitorPresence: vi.fn(),
      onConnectionChange: (status) => {
        statuses.push(status);
      },
    });

    await vi.waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledTimes(1);
    });

    const channel = supabase.__channels[0];
    expect(channel).toBeDefined();
    if (!channel) {
      throw new Error("expected deferred channel");
    }
    expect(channel.subscribeCount).toBe(1);
    expect(statuses.at(-1)).toBe("connecting");

    // Queue a receipt while still connecting — must flush after SUBSCRIBED.
    controller.broadcastReceipt({
      kind: "read",
      lastDeliveredSequence: 4,
      lastReadSequence: 4,
    });
    expect(channel.sendCalls).toHaveLength(0);

    const channelCreatesBeforeAuth = supabase.channel.mock.calls.length;

    // INITIAL_SESSION with the same token while generation N is still joining.
    // Old bug: bumped generation to N+1, returned no-op, then ignored SUBSCRIBED.
    for (const listener of supabase.__authListeners) {
      listener("INITIAL_SESSION", { access_token: "token-stable" });
    }

    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.channel.mock.calls.length).toBe(channelCreatesBeforeAuth);
    expect(channel.subscribeCount).toBe(1);

    channel.emitSubscribed();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(statuses.at(-1)).toBe("connected");
    expect(channel.sendCalls.length).toBeGreaterThanOrEqual(1);
    const receiptSend = channel.sendCalls.find(
      (call) =>
        typeof call === "object" &&
        call !== null &&
        "event" in call &&
        (call as { event: string }).event === "receipt.v1",
    );
    expect(receiptSend).toBeDefined();
    expect(supabase.__channels).toHaveLength(1);

    controller.unsubscribe();
  });

  it("does not bump incarnation or resubscribe on same-token auth while connected", async () => {
    const supabase = createMockSupabase({ accessToken: "token-stable" });
    createClientMock.mockReturnValue(supabase);

    const statuses: string[] = [];
    const controller = subscribeOperatorConversationEphemeral({
      ephemeralTopic: "widget-ephemeral:conv-stable",
      memberId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      onVisitorTyping: vi.fn(),
      onVisitorPresence: vi.fn(),
      onConnectionChange: (status) => {
        statuses.push(status);
      },
    });

    await vi.waitFor(() => {
      expect(statuses).toContain("connected");
    });

    const channel = supabase.__channels[0];
    expect(channel).toBeDefined();
    if (!channel) {
      throw new Error("expected connected channel");
    }
    expect(channel.subscribeCount).toBe(1);
    const createsAfterConnect = supabase.channel.mock.calls.length;

    for (const listener of supabase.__authListeners) {
      listener("INITIAL_SESSION", { access_token: "token-stable" });
      listener("TOKEN_REFRESHED", { access_token: "token-stable" });
    }

    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(channel.subscribeCount).toBe(1);
    expect(supabase.channel.mock.calls.length).toBe(createsAfterConnect);
    expect(channel.presenceAfterSubscribeAttempts).toBe(0);
    expect(statuses.filter((status) => status === "reconnecting")).toHaveLength(
      0,
    );
    expect(statuses.at(-1)).toBe("connected");
    expect(
      supabase.__channels.filter((candidate) =>
        channelMatchesEphemeralTopic(
          candidate.topic,
          "widget-ephemeral:conv-stable",
        ),
      ),
    ).toHaveLength(1);

    controller.unsubscribe();
  });

  it("removes a stale joined channel before binding presence (reuse race)", async () => {
    const topic = "widget-ephemeral:conv-race";
    const supabase = createMockSupabase({ preJoinedTopic: topic });
    createClientMock.mockReturnValue(supabase);

    const controller = subscribeOperatorConversationEphemeral({
      ephemeralTopic: topic,
      memberId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      onVisitorTyping: vi.fn(),
      onVisitorPresence: vi.fn(),
    });

    await vi.waitFor(() => {
      const live = supabase.__channels.filter((candidate) =>
        channelMatchesEphemeralTopic(candidate.topic, topic),
      );
      expect(live.length).toBe(1);
      expect(live[0]?.presenceHandlerCount).toBe(3);
    });

    const live = supabase.__channels.filter((candidate) =>
      channelMatchesEphemeralTopic(candidate.topic, topic),
    );
    const channel = live[0];
    expect(channel).toBeDefined();
    if (!channel) {
      throw new Error("expected live channel after reuse race");
    }
    expect(channel.presenceAfterSubscribeAttempts).toBe(0);
    expect(channel.presenceHandlerCount).toBe(3);
    expect(channel.subscribeCount).toBe(1);

    controller.unsubscribe();
  });

  it("throws from mock channel if presence is bound after subscribe (guard)", () => {
    const channel = new MockRealtimeChannel("widget-ephemeral:guard");
    channel.subscribe();
    expect(() =>
      channel.on("presence", { event: "sync" }, () => undefined),
    ).toThrow(/cannot add `presence` callbacks/);
    expect(channel.presenceAfterSubscribeAttempts).toBe(1);
  });
});
