import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const rpc = vi.fn();
const dispatch = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/email/dispatch-notifications", () => ({ dispatchNotificationEmails: () => { dispatch(); } }));
import { POST } from "./route";
const key = Buffer.alloc(32, 9);
const id = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);
function request(signed = true) {
  const raw = JSON.stringify({ type: "email.received", data: { email_id: id } });
  const time = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key).update(`event.${time}.${raw}`).digest("base64");
  return new Request("https://app.mill.chat/api/internal/conversation-email", { method: "POST", body: raw, headers: signed ? { "svix-id": "event", "svix-timestamp": time, "svix-signature": `v1,${signature}` } : {} });
}
function mail(overrides = {}) {
  return { id, from: "Customer <customer@example.test>", to: [`${token}@reply.mill.chat`], text: "Customer reply", headers: {}, authentication: { dmarc: "pass" }, attachments: [], ...overrides };
}
beforeEach(() => {
  vi.stubEnv("MILL_EMAIL_BRIDGE_ENABLED", "true"); vi.stubEnv("RESEND_RECEIVING_API_KEY", "test");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${key.toString("base64")}`); vi.stubEnv("MILL_EMAIL_REPLY_DOMAIN", "reply.mill.chat");
  rpc.mockReset(); dispatch.mockReset(); rpc.mockResolvedValue({ data: "received", error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(mail())));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("incoming customer email webhook", () => {
  it("rejects unsigned events before contacting provider or database", async () => {
    expect((await POST(request(false))).status).toBe(401); expect(fetch).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("stores authenticated reply through the same-thread RPC", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("receive_conversation_email", { p_provider_id: id, p_token: token, p_sender: "customer@example.test", p_body: "Customer reply" });
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("filters failed authentication and automatic replies", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(mail({ authentication: { dmarc: "fail" } }))).mockResolvedValueOnce(Response.json(mail({ headers: { "Auto-Submitted": "auto-replied" } })));
    await POST(request()); await POST(request()); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not notify twice for provider retries", async () => {
    rpc.mockResolvedValue({ data: "duplicate", error: null }); expect((await POST(request())).status).toBe(200); expect(dispatch).not.toHaveBeenCalled();
  });
  it("requests provider retry on transport or database failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 })); expect((await POST(request())).status).toBe(503);
    rpc.mockResolvedValue({ data: null, error: {} }); expect((await POST(request())).status).toBe(503);
  });
  it("accepts HTML-only replies as plain text without executing embedded content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(mail({ text: null, html: '<p>Yes &amp; thank you</p><script>alert(1)</script>' })));
    await POST(request()); expect(rpc).toHaveBeenCalledWith("receive_conversation_email", expect.objectContaining({ p_body: "Yes & thank you" }));
  });
  it("keeps disabled transport inactive", async () => {
    vi.stubEnv("MILL_EMAIL_BRIDGE_ENABLED", "false"); expect((await POST(request())).status).toBe(503); expect(rpc).not.toHaveBeenCalled();
  });
});
