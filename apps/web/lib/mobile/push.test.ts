import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  mobile: vi.fn(),
  service: vi.fn(),
  billing: vi.fn(),
  quiet: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: state.mobile }));
vi.mock("@/lib/env.server", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: state.service,
}));
vi.mock("@/lib/billing/access", () => ({
  workspaceBillingAccess: state.billing,
}));
vi.mock("@site-chat/shared", () => ({ isQuietHoursActive: state.quiet }));
import { processMobilePush } from "./push";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
let member: Record<string, unknown>, notification: Record<string, unknown>;
let updates: Record<string, unknown>[],
  deletes: string[],
  fetcher: ReturnType<typeof vi.fn>;
let visitor: Record<string, unknown>;
let pushFlags: Record<string, boolean>;
let contextError: unknown;
let soundMode: string;
let receipts: { id: string; ticket_id: string; device_id: string }[];
let onUpdate: (() => void) | undefined;
function chain(table: string) {
  let mutation: string | undefined;
  let update: Record<string, unknown> | undefined;
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    lt: () => query,
    limit: () => query,
    single: () => query,
    maybeSingle: () => query,
    overrideTypes: () => query,
    delete: () => {
      mutation = "delete";
      return query;
    },
    update: (value: Record<string, unknown>) => {
      mutation = "update";
      update = value;
      return query;
    },
    then: (resolve: (value: unknown) => void) => {
      if (table === "visitor_sessions") throw new Error("Direct visitor table lookup is not permitted");
      if (mutation === "update") {
        updates.push(update ?? {});
        onUpdate?.();
      }
      if (mutation === "delete") deletes.push(table);
      const rows: Record<string, unknown> = {
        mobile_push_devices: {
          id: uuid(3),
          user_id: uuid(4),
          member_id: uuid(5),
          workspace_id: uuid(6),
          token: "ExpoPushToken[test]",
          sound_mode: soundMode,
          ...pushFlags,
        },
        notifications: notification,
        visitor_sessions: visitor,
        workspace_members: member,
        notification_preferences: {},
        mobile_push_outbox: receipts,
        mobile_push_visitor_outbox: receipts,
      };
      resolve({
        data: rows[table],
        error: table === "workspace_members" ? contextError : null,
      });
    },
  };
  return query;
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.MOBILE_PUSH_ENABLED = "1";
  delete process.env.MOBILE_VISITOR_PUSH_ENABLED;
  pushFlags = {};
  visitor = {
    id: uuid(8),
    workspace_id: uuid(6),
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  updates = [];
  deletes = [];
  contextError = null;
  soundMode = "mill";
  receipts = [];
  onUpdate = undefined;
  member = {
    id: uuid(5),
    user_id: uuid(4),
    status: "active",
    role: "operator",
  };
  notification = {
    id: uuid(2),
    recipient_id: uuid(5),
    workspace_id: uuid(6),
    conversation_id: uuid(7),
    read_at: null,
    created_at: new Date().toISOString(),
    type: "visitor_message",
    body: "private customer content",
  };
  state.mobile.mockReturnValue({
    from: chain,
    rpc: state.claim,
  });
  state.claim
    .mockReset()
    .mockResolvedValue({ error: null, data: [] })
    .mockResolvedValueOnce({
      error: null,
      data: [
        {
          id: uuid(1),
          notification_id: uuid(2),
          device_id: uuid(3),
          attempts: 1,
        },
      ],
    });
  state.service.mockReturnValue({ from: chain });
  state.billing.mockResolvedValue({ enabled: true });
  state.quiet.mockReturnValue(false);
  fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { status: "ok", id: "ticket" } }),
  });
  vi.stubGlobal("fetch", fetcher);
});
it("sends only generic lock-screen content with the authorized chat destination", async () => {
  expect(await processMobilePush()).toEqual({
    sent: 1,
    skipped: 0,
    claimed: 1,
  });
  const payload = payloadFromFetch();
  expect(payload.data).toEqual({
    workspaceId: uuid(6),
    conversationId: uuid(7),
    notificationId: uuid(2),
    recipientUserId: uuid(4),
  });
  expect(JSON.stringify(payload)).not.toContain("private customer content");
  expect(updates).toContainEqual({ status: "sent", ticket_id: "ticket" });
});
it.each([
  "inactive",
  "viewer",
  "wrong-user",
  "wrong-workspace",
  "read",
  "disabled",
  "quiet",
])("does not send when access/context is %s", async (reason) => {
  if (reason === "inactive") member.status = "inactive";
  if (reason === "viewer") member.role = "viewer";
  if (reason === "wrong-user") member.user_id = uuid(99);
  if (reason === "wrong-workspace") notification.workspace_id = uuid(99);
  if (reason === "read") notification.read_at = new Date().toISOString();
  if (reason === "disabled")
    state.billing.mockResolvedValue({ enabled: false });
  if (reason === "quiet") state.quiet.mockReturnValue(true);
  expect((await processMobilePush()).skipped).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();
});
it("retries access-query failures without sending or discarding the notification", async () => {
  contextError = { message: "temporary database failure" };
  await processMobilePush();
  expect(fetcher).not.toHaveBeenCalled();
  expect(updates[0]).toMatchObject({ status: "pending", claimed_at: null });
});
it("removes invalid devices instead of retrying delivery", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        data: { status: "error", details: { error: "DeviceNotRegistered" } },
      }),
  });
  await processMobilePush();
  expect(deletes).toEqual(["mobile_push_devices"]);
});
it("schedules provider failures for retry", async () => {
  fetcher.mockRejectedValue(new Error("network unavailable"));
  await processMobilePush();
  expect(updates[0]).toMatchObject({ status: "pending", claimed_at: null });
});

it.each([
  ["mill", "mill-message.wav"],
  ["voice", "mill-voice-message.wav"],
  ["system", "default"],
  ["silent", undefined],
])("uses the device's %s sound preference", async (mode, sound) => {
  soundMode = mode;
  await processMobilePush();
  expect(payloadFromFetch().sound).toBe(sound);
});
it("does not send an expired notification after long downtime", async () => {
  notification.created_at = new Date(Date.now() - 2 * 3600000).toISOString();
  expect((await processMobilePush()).skipped).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();
});

it("the server kill switch prevents claims and provider calls", async () => {
  delete process.env.MOBILE_PUSH_ENABLED;
  expect(await processMobilePush()).toEqual({
    sent: 0,
    skipped: 0,
    claimed: 0,
  });
  expect(state.mobile).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("claims one at a time and leaves the next job unclaimed when the budget runs out", async () => {
  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start);
  fetcher.mockImplementation(() => {
    clock.mockReturnValue(start + 36000);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: { status: "ok", id: "ticket" } }),
    });
  });
  try {
    expect((await processMobilePush()).claimed).toBe(1);
    expect(state.claim).toHaveBeenCalledTimes(1);
    expect(state.claim).toHaveBeenCalledWith("claim_mobile_push", {
      p_limit: 1,
    });
  } finally {
    clock.mockRestore();
  }
});
it("expires missing provider receipts without resending accepted notifications", async () => {
  state.claim.mockReset().mockResolvedValue({ error: null, data: [] });
  expect((await processMobilePush()).claimed).toBe(0);
  expect(updates).toContainEqual(
    expect.objectContaining({
      status: "failed",
      receipt_checked_at: expect.any(String) as unknown,
    }),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

function payloadFromFetch(): { data: unknown; sound?: string } {
  const calls = fetcher.mock.calls as unknown as [string, { body: string }][];
  const call = calls[0];
  if (!call) throw new Error("Expected provider request");
  return JSON.parse(call[1].body) as { data: unknown; sound?: string };
}

it("leaves remaining receipts for the next run when the shared budget expires", async () => {
  state.claim.mockReset().mockResolvedValue({ error: null, data: [] });
  receipts = [
    { id: uuid(10), ticket_id: "a", device_id: uuid(3) },
    { id: uuid(11), ticket_id: "b", device_id: uuid(3) },
  ];
  fetcher.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ data: { a: { status: "ok" }, b: { status: "ok" } } }),
  });
  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start);
  onUpdate = () => {
    if (updates.length === 2) clock.mockReturnValue(start + 36000);
  };
  try {
    await processMobilePush();
    expect(updates).toHaveLength(2); // expiry sweep plus only the first receipt
    expect(updates[1]).toMatchObject({ status: "sent" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
  }
});

function enableVisitorJob() {
  visitor.current_visit_started_at ??= visitor.created_at;
  process.env.MOBILE_VISITOR_PUSH_ENABLED = "1";
  pushFlags.push_new_visitor = true;
  state.claim
    .mockReset()
    .mockResolvedValue({ error: null, data: [] })
    .mockResolvedValueOnce({
      error: null,
      data: [
        {
          id: uuid(1),
          visitor_session_id: uuid(8),
          visitor,
          device_id: uuid(3),
          attempts: 1,
        },
      ],
    });
}
it("visitor gate prevents queries before the approved rollout", async () => {
  expect((await processMobilePush({ visitorEvents: true })).claimed).toBe(0);
  expect(state.mobile).not.toHaveBeenCalled();
});
it("sends a generic fresh visitor arrival with its own destination and short lifetime", async () => {
  enableVisitorJob();
  expect((await processMobilePush({ visitorEvents: true })).sent).toBe(1);
  const calls = fetcher.mock.calls as unknown as [string, { body: string }][];
  const call = calls[0];
  if (!call) throw new Error("Expected provider request");
  const payload: unknown = JSON.parse(call[1].body);
  expect(payload).toMatchObject({
    body: "New visitor on your website",
    sound: "mill-conversation.wav",
    ttl: 90,
    data: {
      screen: "visitors",
      visitorId: uuid(8),
      workspaceId: uuid(6),
      recipientUserId: uuid(4),
    },
  });
});
it.each([
  "old-arrival",
  "stale",
  "expired",
  "disabled",
  "wrong-workspace",
  "inactive",
  "quiet",
])("skips a visitor notification when %s", async (reason) => {
  enableVisitorJob();
  if (reason === "old-arrival") {
    visitor.created_at = new Date(Date.now() - 100000).toISOString();
    visitor.current_visit_started_at = visitor.created_at;
  }
  if (reason === "stale")
    visitor.last_seen_at = new Date(Date.now() - 100000).toISOString();
  if (reason === "expired")
    visitor.expires_at = new Date(Date.now() - 1).toISOString();
  if (reason === "disabled") pushFlags.push_new_visitor = false;
  if (reason === "wrong-workspace") visitor.workspace_id = uuid(99);
  if (reason === "inactive") member.status = "inactive";
  if (reason === "quiet") state.quiet.mockReturnValue(true);
  expect((await processMobilePush({ visitorEvents: true })).skipped).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(["conversation_new", "visitor_message"])(
  "honors the independent %s preference",
  async (kind) => {
    notification.type = kind;
    pushFlags = { push_new_chat: false, push_messages: false };
    expect((await processMobilePush()).skipped).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("uses the dedicated voice visitor sound", async () => {
  enableVisitorJob();
  soundMode = "voice";
  expect((await processMobilePush({ visitorEvents: true })).sent).toBe(1);
  const calls = fetcher.mock.calls as unknown as [string, { body: string }][];
  const call = calls[0];
  if (!call) throw new Error("Expected provider request");
  expect(JSON.parse(call[1].body)).toMatchObject({
    sound: "mill-voice-visitor.wav",
  });
});

it("a returning visit sends despite a days-old visitor identity", async () => {
 enableVisitorJob(); visitor.created_at = new Date(Date.now()-86400000).toISOString(); visitor.current_visit_started_at = new Date().toISOString();
 expect((await processMobilePush({ visitorEvents: true })).sent).toBe(1);
});
it("a late job never revives an expired visit", async () => {
 enableVisitorJob(); visitor.created_at = new Date().toISOString(); visitor.current_visit_started_at = new Date(Date.now()-100000).toISOString();
 expect((await processMobilePush({ visitorEvents: true })).skipped).toBe(1); expect(fetcher).not.toHaveBeenCalled();
});

it("a revoked visitor context is skipped without table access or provider delivery", async () => {
 process.env.MOBILE_VISITOR_PUSH_ENABLED="1";
 state.claim.mockReset().mockResolvedValue({ error: null, data: [] }).mockResolvedValueOnce({ error: null, data: [{ id: uuid(1), device_id: uuid(3), visitor_session_id: uuid(8), attempts: 1, visitor: null }] });
 expect((await processMobilePush({ visitorEvents: true })).skipped).toBe(1); expect(fetcher).not.toHaveBeenCalled();
});
