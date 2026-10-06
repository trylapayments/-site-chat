import { afterEach, describe, expect, it, vi } from "vitest";
const { after, processOutbox } = vi.hoisted(() => ({
  after: vi.fn<(callback: () => Promise<void>) => void>(),
  processOutbox: vi.fn(),
}));
vi.mock("next/server", () => ({ after }));
vi.mock("./notification-email", () => ({
  processNotificationEmailOutbox: processOutbox,
}));
import { dispatchNotificationEmails } from "./dispatch-notifications";
describe("immediate notification dispatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it("does not schedule without email configuration", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    dispatchNotificationEmails();
    expect(after).not.toHaveBeenCalled();
  });
  it("sends after the visitor response", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    dispatchNotificationEmails();
    expect(processOutbox).not.toHaveBeenCalled();
    const callback = after.mock.calls[0]?.[0];
    expect(callback).toBeDefined();
    await callback?.();
    expect(processOutbox).toHaveBeenCalledWith({ limit: 5 });
  });
  it("leaves delivery failures to the retry worker", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    processOutbox.mockRejectedValueOnce(new Error("unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dispatchNotificationEmails();
    const callback = after.mock.calls[0]?.[0];
    expect(callback).toBeDefined();
    await expect(callback?.()).resolves.toBeUndefined();
    log.mockRestore();
  });
});
