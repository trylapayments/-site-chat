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
        },
        notifications: notification,
        workspace_members: member,
        notification_preferences: {},
        mobile_push_outbox: receipts,
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
