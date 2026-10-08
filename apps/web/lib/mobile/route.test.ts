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
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("@/lib/mobile/access", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  authenticateMobile: mocks.authenticate,
  authorizeMobile: mocks.authorize,
}));
vi.mock("@/lib/inbox/queries", () => ({
  sendOperatorMessage: mocks.send,
  fetchConversation: mocks.conversation,
  updateInternalNote: mocks.updateNote,
  softDeleteInternalNote: mocks.deleteNote,
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
  delete process.env.MOBILE_PUSH_ENABLED;
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

it.each(["updateNote", "deleteNote"])(
  "rechecks notes permissions for %s",
  async (operation) => {
    mocks.authorize.mockRejectedValue(
      new MobileError(403, "FORBIDDEN", "Denied"),
    );
    const result = await POST(
      request({
        operation,
        workspaceId,
        input: { noteId: conversationId, body: "Changed" },
      }),
    );
    expect(result.status).toBe(403);
    expect(mocks.authorize.mock.calls[0][2]).toBe("manage_internal_notes");
    expect(mocks.updateNote).not.toHaveBeenCalled();
    expect(mocks.deleteNote).not.toHaveBeenCalled();
  },
);
it.each(["updateNote", "deleteNote"])(
  "rejects malformed note identity for %s",
  async (operation) => {
    const result = await POST(
      request({ operation, workspaceId, input: { noteId: "bad" } }),
    );
    expect(result.status).toBe(400);
    expect(mocks.updateNote).not.toHaveBeenCalled();
    expect(mocks.deleteNote).not.toHaveBeenCalled();
  },
);
it("preserves mentions when updating a note", async () => {
  const input = {
    noteId: conversationId,
    body: "Changed",
    mentionedMemberIds: [clientMessageId],
  };
  mocks.updateNote.mockResolvedValue({ id: conversationId });
  const result = await POST(
    request({ operation: "updateNote", workspaceId, input }),
  );
  expect(result.status).toBe(200);
  expect(mocks.updateNote).toHaveBeenCalledWith({}, workspaceId, input);
});
it("uses existing soft deletion in the authorized workspace", async () => {
  mocks.deleteNote.mockResolvedValue({ id: conversationId, deleted_at: "now" });
  const result = await POST(
    request({
      operation: "deleteNote",
      workspaceId,
      input: { noteId: conversationId },
    }),
  );
  expect(result.status).toBe(200);
  expect(mocks.deleteNote).toHaveBeenCalledWith({}, workspaceId, {
    noteId: conversationId,
  });
});

it("registers only the verified user and freshly authorized member", async () => {
  process.env.MOBILE_PUSH_ENABLED = "1";
  const rpc = vi.fn().mockResolvedValue({ error: null });
  mocks.push.mockReturnValue({ rpc });
  const result = await POST(
    request({
      operation: "registerPush",
      workspaceId,
      input: {
        installationId: clientMessageId,
        token: "ExpoPushToken[valid_token]",
      },
    }),
  );
  expect(result.status).toBe(200);
  expect(mocks.authorize).toHaveBeenCalledWith(
    expect.anything(),
    workspaceId,
    "send_messages",
  );
  expect(rpc).toHaveBeenCalledWith("register_mobile_push", {
    p_user_id: "user",
    p_member_id: "member",
    p_workspace_id: workspaceId,
    p_installation_id: clientMessageId,
    p_token: "ExpoPushToken[valid_token]",
    p_sound_mode: "mill",
  });
});
it("denied workspace cannot register a push device", async () => {
  process.env.MOBILE_PUSH_ENABLED = "1";
  mocks.authorize.mockRejectedValue(
    new MobileError(403, "FORBIDDEN", "Denied"),
  );
  const result = await POST(
    request({
      operation: "registerPush",
      workspaceId,
      input: { installationId: clientMessageId, token: "ExpoPushToken[valid]" },
    }),
  );
  expect(result.status).toBe(403);
  expect(mocks.push).not.toHaveBeenCalled();
});
it("unregisters only this authenticated user installation without requiring workspace access", async () => {
  process.env.MOBILE_PUSH_ENABLED = "1";
  const filters: unknown[] = [];
  const chain = {
    eq: (key: string, value: string) => {
      filters.push([key, value]);
      return chain;
    },
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  mocks.push.mockReturnValue({ from: () => ({ delete: () => chain }) });
  const result = await POST(
    request({
      operation: "unregisterPush",
      input: { installationId: clientMessageId },
    }),
  );
  expect(result.status).toBe(200);
  expect(filters).toEqual([
    ["user_id", "user"],
    ["installation_id", clientMessageId],
  ]);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
