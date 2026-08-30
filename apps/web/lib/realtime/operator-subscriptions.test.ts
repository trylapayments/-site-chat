import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeOperatorWorkspaceInbox } from "./operator-subscriptions";

type MockChannelState = "closed" | "joining" | "joined";

class MockRealtimeChannel {
  topic: string;
  state: MockChannelState = "closed";
  subscribeCount = 0;
  bindingCount = 0;
  private subscribeCallback: ((status: string) => void) | null = null;
  private readonly deferSubscribed: boolean;

  constructor(name: string, options?: { deferSubscribed?: boolean }) {
    this.topic = `realtime:${name}`;
    this.deferSubscribed = options?.deferSubscribed ?? false;
  }

  on(): this {
    this.bindingCount += 1;
    return this;
  }

  subscribe(callback?: (status: string) => void): this {
    this.subscribeCount += 1;
    this.state = "joining";
    this.subscribeCallback = callback ?? null;
    if (!this.deferSubscribed) {
      queueMicrotask(() => {
        this.emitSubscribed();
      });
    }
    return this;
  }

  emitSubscribed(): void {
    this.state = "joined";
    this.subscribeCallback?.("SUBSCRIBED");
  }
}

function createMockSupabase(options?: {
  accessToken?: string;
  deferSubscribed?: boolean;
}) {
  const accessToken = options?.accessToken ?? "token-stable";
  const channels: MockRealtimeChannel[] = [];
  const authListeners: Array<
    (event: string, session: { access_token: string } | null) => void
  > = [];

  const client = {
    removeChannel: vi.fn((channel: MockRealtimeChannel) => {
      const index = channels.indexOf(channel);
      if (index >= 0) {
        channels.splice(index, 1);
      }
      channel.state = "closed";
      return Promise.resolve("ok");
    }),
    channel: vi.fn((name: string) => {
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
  };

  return client;
}

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

describe("subscribeOperatorWorkspaceInbox auth lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    createClientMock.mockReset();
  });

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("does not resubscribe on same-token INITIAL_SESSION while connecting", async () => {
    const supabase = createMockSupabase({
      accessToken: "token-stable",
      deferSubscribed: true,
    });
    createClientMock.mockReturnValue(supabase);

    const statuses: string[] = [];
    const unsubscribe = subscribeOperatorWorkspaceInbox({
      workspaceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      memberId: "11111111-2222-3333-4444-555555555555",
      onMessageInsert: vi.fn(),
      onConversationChange: vi.fn(),
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
      throw new Error("expected deferred inbox channel");
    }
    const createsBeforeAuth = supabase.channel.mock.calls.length;

    for (const listener of supabase.__authListeners) {
      listener("INITIAL_SESSION", { access_token: "token-stable" });
    }
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.channel.mock.calls.length).toBe(createsBeforeAuth);
    expect(channel.subscribeCount).toBe(1);
    expect(statuses.filter((status) => status === "reconnecting")).toHaveLength(
      0,
    );

    channel.emitSubscribed();
    await flushMicrotasks();
    expect(statuses.at(-1)).toBe("connected");
    expect(supabase.removeChannel).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("does not resubscribe on same-token TOKEN_REFRESHED while connected", async () => {
    const supabase = createMockSupabase({ accessToken: "token-stable" });
    createClientMock.mockReturnValue(supabase);

    const statuses: string[] = [];
    const unsubscribe = subscribeOperatorWorkspaceInbox({
      workspaceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      memberId: "11111111-2222-3333-4444-555555555555",
      onMessageInsert: vi.fn(),
      onConversationChange: vi.fn(),
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
      throw new Error("expected connected inbox channel");
    }
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
    expect(statuses.filter((status) => status === "reconnecting")).toHaveLength(
      0,
    );
    expect(statuses.at(-1)).toBe("connected");

    unsubscribe();
  });
});
