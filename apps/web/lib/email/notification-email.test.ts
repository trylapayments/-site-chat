import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({})),
}));

import {
  processNotificationEmailOutbox,
  type ClaimedOutboxRow,
  type NotificationEmailProcessorDeps,
} from "./notification-email";

function claimedRow(id: string): ClaimedOutboxRow {
  return {
    id,
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

    const deps = { claim, finalize, send };

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
    expect(a.sent + b.sent).toBe(1);
    expect(a.processed + b.processed).toBe(1);
  });

  it("failed send finalizes as failed (retryable)", async () => {
    const finalize = vi.fn(() => Promise.resolve(true));
    const result = await processNotificationEmailOutbox({
      resendApiKey: "re_test",
      supabase: {} as never,
      deps: {
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

  it("missing Resend config skips and never marks sent", async () => {
    const finalize = vi.fn(() => Promise.resolve(true));
    const send = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: "unused" }),
    );
    const result = await processNotificationEmailOutbox({
      resendApiKey: null,
      supabase: {} as never,
      deps: {
        claim: () =>
          Promise.resolve([claimedRow("44444444-4444-4444-4444-444444444444")]),
        finalize,
        send,
      },
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
        lastError: "RESEND_API_KEY missing",
      }),
    );
  });
});
