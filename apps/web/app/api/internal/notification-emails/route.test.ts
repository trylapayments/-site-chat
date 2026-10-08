vi.mock("@/lib/account/cleanup", () => ({
  processAccountDeletionCleanup: vi
    .fn()
    .mockResolvedValue({ removed: 0, pending: false }),
}));
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/email/conversation/delivery", () => ({
  processConversationEmailOutbox: vi.fn().mockResolvedValue({ sent: 0 }),
}));

vi.mock("@/lib/email/notification-email", () => ({
  processNotificationEmailOutbox: vi.fn(),
}));

import { processAccountDeletionCleanup } from "@/lib/account/cleanup";
import { processNotificationEmailOutbox } from "@/lib/email/notification-email";
import { POST } from "./route";

const secret = "test-only-secret-at-least-thirty-two-characters";
const request = (authorization?: string) =>
  new Request("https://example.com/api/internal/notification-emails", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

function configure() {
  vi.stubEnv("NOTIFICATION_EMAIL_CRON_SECRET", secret);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "Mill <notifications@notify.mill.chat>");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("notification email worker endpoint", () => {
  it("fails closed without a strong scheduler secret", async () => {
    vi.stubEnv("NOTIFICATION_EMAIL_CRON_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    expect(processNotificationEmailOutbox).not.toHaveBeenCalled();
  });

  it("rejects missing and invalid credentials without claiming emails", async () => {
    configure();
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("Bearer wrong"))).status).toBe(401);
    expect(processNotificationEmailOutbox).not.toHaveBeenCalled();
  });

  it("preserves the queue while the provider is unconfigured", async () => {
    configure();
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
    expect(processNotificationEmailOutbox).not.toHaveBeenCalled();
    expect(processAccountDeletionCleanup).toHaveBeenCalledTimes(1);
  });

  it("processes a bounded batch only with the scheduler credential", async () => {
    configure();
    vi.mocked(processNotificationEmailOutbox).mockResolvedValue({
      processed: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    const response = await POST(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(processNotificationEmailOutbox).toHaveBeenCalledWith({ limit: 5 });
    expect(await response.json()).toEqual({
      processed: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
      customerReplies: { sent: 0 },
      accountCleanup: { removed: 0, pending: false },
    });
  });

  it("does not expose secrets or database errors", async () => {
    configure();
    vi.mocked(processNotificationEmailOutbox).mockRejectedValue(
      new Error(secret),
    );
    const response = await POST(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
  });
});
