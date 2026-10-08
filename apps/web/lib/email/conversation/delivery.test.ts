import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc }) }));
import { processConversationEmailOutbox } from "./delivery";
const row = { id: "00000000-0000-4000-8000-000000000001", lease: "00000000-0000-4000-8000-000000000002", conversation_id: "00000000-0000-4000-8000-000000000003", body: "Public reply <script>alert(1)</script>", sender_label: "Alex", to: "customer@example.test", reply_token: "a".repeat(64) };
beforeEach(() => {
  vi.stubEnv("MILL_EMAIL_BRIDGE_ENABLED", "true"); vi.stubEnv("RESEND_API_KEY", "test");
  vi.stubEnv("RESEND_FROM_EMAIL", "Mill <notifications@notify.mill.chat>"); vi.stubEnv("MILL_EMAIL_REPLY_DOMAIN", "reply.mill.chat");
  rpc.mockReset(); rpc.mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValue({ data: true, error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "provider-id" })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("customer reply email delivery", () => {
  it("uses a stable provider key, conversation reply address and escaped branded HTML", async () => {
    expect(await processConversationEmailOutbox(1)).toEqual({ sent: 1, failed: 0 });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[1]?.headers).toEqual(expect.objectContaining({ "Idempotency-Key": `mill-conversation/${row.id}` }));
    const payload = z.object({ reply_to: z.string(), html: z.string(), text: z.string() }).parse(JSON.parse(z.string().parse(call?.[1]?.body)));
    expect(payload.reply_to).toBe(`${row.reply_token}@reply.mill.chat`);
    expect(payload.reply_to.split("@")[0]?.length).toBeLessThanOrEqual(64);
    expect(payload.html).toContain("&lt;script&gt;"); expect(payload.html).not.toContain("<script>");
    expect(payload.text).toContain("Reply to this email");
    expect(rpc).toHaveBeenLastCalledWith("finalize_conversation_email_outbox", expect.objectContaining({ p_lease: row.lease, p_status: "sent" }));
  });
  it("leaves the queue untouched when disabled", async () => {
    vi.stubEnv("MILL_EMAIL_BRIDGE_ENABLED", "false"); expect(await processConversationEmailOutbox(1)).toEqual({ sent: 0, failed: 0 }); expect(rpc).not.toHaveBeenCalled();
  });
  it("records retryable provider failures without logging content", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429 })); expect(await processConversationEmailOutbox(1)).toEqual({ sent: 0, failed: 1 });
    expect(rpc).toHaveBeenLastCalledWith("finalize_conversation_email_outbox", expect.objectContaining({ p_status: "failed", p_error: "Provider HTTP 429" }));
  });
  it("reports loss of lease instead of pretending finalization succeeded", async () => {
    rpc.mockReset(); rpc.mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValueOnce({ data: false, error: null });
    await expect(processConversationEmailOutbox(1)).rejects.toThrow("finalization failed");
  });
});
