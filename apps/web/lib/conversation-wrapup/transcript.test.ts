import { z } from "zod";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const { rpc, from, fetcher } = vi.hoisted(() => ({
  rpc: vi.fn<
    (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: null }>
  >(),
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
  for (const method of ["select", "eq", "update", "single"])
    q[method] = vi.fn(() => q);
  q.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return q;
}
const message = {
  sender_type: "visitor",
  body: "Hi",
  is_internal: false,
  created_at: "2026-10-05T10:00:00Z",
  metadata_json: {},
  agent_member_id: null,
  agent_name: "Agent",
};
function claimed() {
  rpc.mockImplementation((name) =>
    Promise.resolve({
      data:
        name === "claim_conversation_transcript"
          ? "claimed"
          : { workspaceName: "Example", messages: [message] },
      error: null,
    }),
  );
}
function sentBody() {
  const body = fetcher.mock.calls[0]?.[1].body;
  if (typeof body !== "string") throw new Error("Email request missing");
  return z
    .object({ text: z.string(), to: z.array(z.string()) })
    .passthrough()
    .parse(JSON.parse(body));
}
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  rpc.mockReset();
  from.mockReset();
  fetcher.mockReset();
  from.mockImplementation(() => query({ payload: null }));
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
  it("reads only a scoped request and sends with a durable idempotency key", async () => {
    claimed();
    fetcher.mockResolvedValue({ ok: true });
    await sendConversationTranscript(input);
    expect(rpc).toHaveBeenCalledWith("read_conversation_transcript", {
      p_workspace_id: "workspace",
      p_request_id: "request",
      p_offset: 0,
    });
    expect(from).not.toHaveBeenCalledWith("messages");
    expect(
      new Headers(fetcher.mock.calls[0]?.[1].headers).get("Idempotency-Key"),
    ).toBe("mill-transcript-request");
    expect(sentBody().text).toContain("Hi");
    expect(sentBody().to).toEqual(["visitor@example.com"]);
  });
  it("paginates a conversation beyond the first 500 messages", async () => {
    rpc.mockImplementation((name, args) =>
      Promise.resolve({
        data:
          name === "claim_conversation_transcript"
            ? "claimed"
            : {
                workspaceName: "Example",
                messages:
                  args.p_offset === 0
                    ? Array.from({ length: 500 }, () => message)
                    : [{ ...message, body: "Message 501" }],
              },
        error: null,
      }),
    );
    fetcher.mockResolvedValue({ ok: true });
    await sendConversationTranscript(input);
    expect(rpc).toHaveBeenCalledWith(
      "read_conversation_transcript",
      expect.objectContaining({ p_offset: 500 }),
    );
    expect(sentBody().text).toContain("Message 501");
  });
  it("marks provider failures as failed and never reports success", async () => {
    claimed();
    const final = query({ payload: null });
    from.mockImplementation(() => final);
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
    expect(rpc).not.toHaveBeenCalledWith(
      "read_conversation_transcript",
      expect.anything(),
    );
    expect(sentBody()).toEqual(payload);
  });
  it("fails explicitly when email delivery has not been configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(sendConversationTranscript(input)).rejects.toThrow(
      "not configured",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
