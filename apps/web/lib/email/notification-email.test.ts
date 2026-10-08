import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({})),
}));

import {
  processNotificationEmailOutbox,
  prepareNotificationEmail,
  type ClaimedOutboxRow,
  type NotificationEmailProcessorDeps,
} from "./notification-email";

function claimedRow(id: string): ClaimedOutboxRow {
  return {
    id,
    recipient_member_id: "11111111-1111-1111-1111-111111111112",
    notification_id: null,
    email_category: "assignment",
    created_at: new Date().toISOString(),
    workspace_id: "11111111-1111-1111-1111-111111111111",
    to_email: "agent@example.com",
    subject: "Conversation assigned to you",
    status: "sending",
    attempts: 1,
  };
}

describe("processNotificationEmailOutbox", () => {
  it("two workers: exactly one provider send for the same logical claim pool", async () => {
    const row = claimedRow("22222222-2222-2222-2222-222222222222");
    let remaining: ClaimedOutboxRow[] = [row];
    const send = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        providerMessageId: "msg_1",
      }),
    );
    const finalize = vi.fn(() => Promise.resolve(true));

    const claim: NotificationEmailProcessorDeps["claim"] = () => {
      const next = remaining;
      remaining = [];
      return Promise.resolve(next);
    };

    const deps = {
      claim,
      finalize,
      send,
      prepare: () =>
        Promise.resolve({ href: "https://mill.chat/app/test/inbox" }),
    };

    const [a, b] = await Promise.all([
      processNotificationEmailOutbox({
        resendApiKey: "re_test",
        deps,
        supabase: {} as never,
      }),
      processNotificationEmailOutbox({
        resendApiKey: "re_test",
        deps,
        supabase: {} as never,
      }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `mill-notification/${row.id}`,
      }),
    );
    expect(a.sent + b.sent).toBe(1);
    expect(a.processed + b.processed).toBe(1);
  });

  it("failed send finalizes as failed (retryable)", async () => {
    const finalize = vi.fn(() => Promise.resolve(true));
    const result = await processNotificationEmailOutbox({
      resendApiKey: "re_test",
      supabase: {} as never,
      deps: {
        prepare: () =>
          Promise.resolve({ href: "https://mill.chat/app/test/inbox" }),
        claim: () =>
          Promise.resolve([claimedRow("33333333-3333-3333-3333-333333333333")]),
        finalize,
        send: () => Promise.resolve({ ok: false, error: "Resend HTTP 500" }),
      },
    });

    expect(result.failed).toBe(1);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: "Resend HTTP 500",
      }),
    );
  });

  it("missing Resend config leaves notifications queued for later delivery", async () => {
    const finalize = vi.fn(() => Promise.resolve(true));
    const send = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: "unused" }),
    );
    const result = await processNotificationEmailOutbox({
      resendApiKey: null,
      supabase: {} as never,
      deps: {
        prepare: () =>
          Promise.resolve({ href: "https://mill.chat/app/test/inbox" }),
        claim: () =>
          Promise.resolve([claimedRow("44444444-4444-4444-4444-444444444444")]),
        finalize,
        send,
      },
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.skipped).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(finalize).not.toHaveBeenCalled();
  });
});

function contextClient(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    workspace_members: {
      status: "active",
      user_id: "test-user",
      role: "agent",
    },
    workspaces: { slug: "mill-test", status: "active", deleted_at: null },
    notification_preferences: { email_assignment: true, dnd_enabled: false },
    notifications: {
      conversation_id: "44444444-4444-4444-4444-444444444444",
      read_at: null,
    },
    ...overrides,
  };
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: values[table], error: null }),
    };
    return chain;
  });
  return {
    from,
    auth: {
      admin: {
        getUserById: vi.fn(() =>
          Promise.resolve({
            data: { user: { email: "al@millcorn.com" } },
            error: null,
          }),
        ),
      },
    },
  };
}

function deliverableRow() {
  return {
    ...claimedRow("22222222-2222-2222-2222-222222222222"),
    to_email: "al@millcorn.com",
    notification_id: "33333333-3333-3333-3333-333333333333",
  };
}

describe("delivery-time recipient and notification checks", () => {
  it("links directly to the workspace conversation without tokens", async () => {
    const result = await prepareNotificationEmail(
      contextClient() as never,
      deliverableRow(),
      "https://mill.chat/?token=never-include",
    );
    expect(result).toEqual({
      href: "https://mill.chat/app/mill-test/inbox/44444444-4444-4444-4444-444444444444",
    });
  });
  it("does not send reserved test addresses or expired notification history", async () => {
    const client = contextClient();
    expect(
      await prepareNotificationEmail(
        client as never,
        { ...deliverableRow(), to_email: "test@mill.invalid" },
        "https://mill.chat",
      ),
    ).toEqual({ skip: "Reserved test recipient" });
    expect(
      await prepareNotificationEmail(
        client as never,
        {
          ...deliverableRow(),
          created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
        "https://mill.chat",
      ),
    ).toEqual({ skip: "Notification expired" });
    expect(client.from).not.toHaveBeenCalled();
  });
  it("cancels email after the notification has been read", async () => {
    const client = contextClient({
      notifications: {
        conversation_id: null,
        read_at: new Date().toISOString(),
      },
    });
    expect(
      await prepareNotificationEmail(
        client as never,
        deliverableRow(),
        "https://mill.chat",
      ),
    ).toEqual({ skip: "Notification already read or removed" });
  });
  it("rechecks DND and email preferences at delivery", async () => {
    for (const prefs of [
      { email_assignment: false, dnd_enabled: false },
      { email_assignment: true, dnd_enabled: true },
    ]) {
      const client = contextClient({ notification_preferences: prefs });
      expect(
        await prepareNotificationEmail(
          client as never,
          deliverableRow(),
          "https://mill.chat",
        ),
      ).toEqual({ skip: "Email preferences suppress delivery" });
    }
  });
  it("does not deliver to disabled members or a previous account email", async () => {
    const disabled = contextClient({
      workspace_members: { status: "disabled" },
    });
    expect(
      await prepareNotificationEmail(
        disabled as never,
        deliverableRow(),
        "https://mill.chat",
      ),
    ).toEqual({ skip: "Recipient or workspace inactive" });
    expect(
      await prepareNotificationEmail(
        contextClient() as never,
        { ...deliverableRow(), to_email: "previous@millcorn.com" },
        "https://mill.chat",
      ),
    ).toEqual({ skip: "Recipient address changed" });
  });
  it("email-only preferences still link to Inbox when in-app history was disabled", async () => {
    expect(
      await prepareNotificationEmail(
        contextClient() as never,
        { ...deliverableRow(), notification_id: null },
        "https://mill.chat",
      ),
    ).toEqual({ href: "https://mill.chat/app/mill-test/inbox" });
  });
});
