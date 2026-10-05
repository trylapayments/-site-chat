import { z } from "zod";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const { rpc, from, fetcher } = vi.hoisted(() => ({
  rpc: vi.fn<() => Promise<{ data: string; error: null }>>(),
  from: vi.fn<(table: string) => ReturnType<typeof query>>(),
  fetcher:
    vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean }>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc, from }),
}));
import { sendConversationTranscript } from "./transcript";
const input = {
  workspaceId: "workspace",
  conversationId: "conversation",
  requestId: "request",
  email: "visitor@example.com",
};
function query(data: unknown, error: unknown = null) {
  const q: Record<string, unknown> = {};
  for (const name of [
    "select",
    "eq",
    "in",
    "order",
    "range",
    "update",
    "single",
  ])
    q[name] = vi.fn(() => q);
  q.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return q;
}
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  rpc.mockReset();
  from.mockReset();
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("transcript delivery", () => {
  it("does not call the provider without a claim, or resend completed requests", async () => {
    rpc.mockResolvedValue({ data: "sent", error: null });
    await sendConversationTranscript(input);
    expect(fetcher).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: "limited", error: null });
    await expect(sendConversationTranscript(input)).rejects.toThrow("Too many");
    expect(from).not.toHaveBeenCalled();
  });
  it("keeps a scoped idempotency key and sends only the public transcript", async () => {
    rpc.mockResolvedValue({ data: "claimed", error: null });
    const messages = query([
      {
        sender_type: "visitor",
        body: "Hi",
        is_internal: false,
        created_at: "2026-10-05T10:00:00Z",
        metadata_json: {},
        agent_member_id: null,
      },
      {
        sender_type: "agent",
        body: "SECRET",
        is_internal: true,
        created_at: "2026-10-05T10:00:00Z",
        metadata_json: {},
        agent_member_id: null,
      },
    ]);
    from.mockImplementation((table) =>
      table === "workspaces"
        ? query({ name: "Example" })
        : table === "messages"
          ? messages
          : query({ payload: null }),
    );
    fetcher.mockResolvedValue({ ok: true });
    await sendConversationTranscript(input);
    expect(messages.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(messages.eq).toHaveBeenCalledWith("conversation_id", "conversation");
    expect(messages.eq).toHaveBeenCalledWith("is_internal", false);
    const request = fetcher.mock.calls[0]?.[1];
    if (!request) throw new Error("No email request");
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe(
      "mill-transcript-request",
    );
    const body = z
      .object({ text: z.string(), to: z.array(z.string()) })
      .parse(JSON.parse(typeof request.body === "string" ? request.body : ""));
    expect(body.text).toContain("Hi");
    expect(body.text).not.toContain("SECRET");
    expect(body.to).toEqual(["visitor@example.com"]);
  });
  it("marks provider failures as failed and never reports success", async () => {
    rpc.mockResolvedValue({ data: "claimed", error: null });
    const final = query({ payload: null });
    from.mockImplementation((table) =>
      table === "workspaces"
        ? query({ name: "Example" })
        : table === "messages"
          ? query([])
          : final,
    );
    fetcher.mockResolvedValue({ ok: false });
    await expect(sendConversationTranscript(input)).rejects.toThrow(
      "Email could not be sent",
    );
    expect(final.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });
  it("retries the saved email snapshot without re-reading a changed conversation", async () => {
    rpc.mockResolvedValue({ data: "claimed", error: null });
    const payload = {
      from: "Mill <notifications@example.com>",
      to: ["visitor@example.com"],
      subject: "Original subject",
      text: "Original conversation",
    };
    from.mockImplementation(() => query({ payload }));
    fetcher.mockResolvedValue({ ok: true });
    await sendConversationTranscript(input);
    expect(from).not.toHaveBeenCalledWith("messages");
    expect(
      JSON.parse(
        typeof fetcher.mock.calls[0]?.[1].body === "string"
          ? fetcher.mock.calls[0][1].body
          : "",
      ),
    ).toEqual(payload);
  });
  it("fails explicitly when email delivery has not been configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(sendConversationTranscript(input)).rejects.toThrow(
      "not configured",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
