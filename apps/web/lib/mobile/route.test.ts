import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorize: vi.fn(),
  send: vi.fn(),
  workspaces: vi.fn(),
  push: vi.fn(),
  uploads: vi.fn(),
  conversation: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("@/lib/mobile/access", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  authenticateMobile: mocks.authenticate,
  authorizeMobile: mocks.authorize,
}));
vi.mock("@/lib/inbox/queries", () => ({
  sendOperatorMessage: mocks.send,
  fetchConversation: mocks.conversation,
}));
vi.mock("@/lib/workspace/queries", () => ({
  fetchAccessibleWorkspaces: mocks.workspaces,
}));
vi.mock("@/lib/mobile/push", () => ({ mobileService: mocks.push }));
vi.mock("@/lib/attachments/service", () => ({
  completeOperatorUploads: mocks.complete,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    const chain = { select: () => chain, eq: () => chain, in: mocks.uploads };
    return { from: () => chain };
  },
}));
import { POST } from "@/app/api/v1/mobile/route";
import { MobileError } from "./access";
const workspaceId = "12345678-1234-4123-8123-123456789abc";
const conversationId = "12345678-1234-4123-8123-123456789abd";
const clientMessageId = "12345678-1234-4123-8123-123456789abe";
const request = (body: unknown) =>
  new Request("https://test/api/v1/mobile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ client: {}, user: { id: "user" } });
  mocks.authorize.mockResolvedValue({ memberId: "member" });
  mocks.send.mockResolvedValue({ message: { id: "stable" } });
});
it("requires stable idempotency identity for every mobile send", async () => {
  const result = await POST(
    request({
      operation: "send",
      workspaceId,
      input: { conversationId, body: "Hi" },
    }),
  );
  expect(result.status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("passes original retry UUID unchanged to existing RPC", async () => {
  expect(
    (
      await POST(
        request({
          operation: "send",
          workspaceId,
          input: { conversationId, body: "Hi", clientMessageId },
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.send).toHaveBeenCalledWith(
    {},
    workspaceId,
    conversationId,
    "Hi",
    clientMessageId,
  );
});
it("authorization failure cannot reach mutation", async () => {
  mocks.authorize.mockRejectedValue(
    new MobileError(403, "FORBIDDEN", "Denied"),
  );
  expect(
    (
      await POST(
        request({
          operation: "send",
          workspaceId,
          input: { conversationId, body: "Hi", clientMessageId },
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("unknown operations never become arbitrary RPC execution", async () => {
  expect(
    (
      await POST(
        request({
          operation: "admin_sql",
          workspaceId,
          input: { sql: "SELECT 1" },
        }),
      )
    ).status,
  ).toBe(400);
});
it("advertises unavailable push without querying its optional schema", async () => {
  const result = await POST(request({ operation: "capabilities" }));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ data: { apiVersion: 1, push: false } });
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
it.each(["registerPush", "unregisterPush"])(
  "rejects %s before optional push infrastructure is enabled",
  async (operation) => {
    const result = await POST(request({ operation, workspaceId, input: {} }));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: { code: "FEATURE_UNAVAILABLE" },
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  },
);
it("hides database errors from clients", async () => {
  mocks.send.mockRejectedValue(new Error("secret internal details"));
  const result = await POST(
    request({
      operation: "send",
      workspaceId,
      input: { conversationId, body: "Hi", clientMessageId },
    }),
  );
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("secret internal");
});

it.each([
  ["missing data", null],
  [
    "different member",
    [
      {
        id: clientMessageId,
        agent_member_id: "other",
        conversation_id: conversationId,
      },
    ],
  ],
  [
    "different conversation",
    [
      {
        id: clientMessageId,
        agent_member_id: "member",
        conversation_id: workspaceId,
      },
    ],
  ],
  ["missing upload", []],
])("cannot finalize attachments with %s", async (_description, uploads) => {
  mocks.conversation.mockResolvedValue({ id: conversationId });
  mocks.uploads.mockResolvedValue({ data: uploads, error: null });
  const result = await POST(
    request({
      operation: "completeUpload",
      workspaceId,
      input: {
        conversationId,
        clientMessageId,
        batchId: workspaceId,
        uploadIds: [clientMessageId],
      },
    }),
  );
  expect(result.status).toBe(403);
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("finalizes only uploads owned by the authenticated conversation member", async () => {
  mocks.conversation.mockResolvedValue({ id: conversationId });
  mocks.uploads.mockResolvedValue({
    data: [
      {
        id: clientMessageId,
        agent_member_id: "member",
        conversation_id: conversationId,
      },
    ],
    error: null,
  });
  mocks.complete.mockResolvedValue({ message: { id: "attachment" } });
  const result = await POST(
    request({
      operation: "completeUpload",
      workspaceId,
      input: {
        conversationId,
        clientMessageId,
        batchId: workspaceId,
        uploadIds: [clientMessageId],
      },
    }),
  );
  expect(result.status).toBe(200);
  expect(mocks.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId,
      conversationId,
      clientMessageId,
      authedClient: {},
    }),
  );
});
