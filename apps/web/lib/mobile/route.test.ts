import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  accountPreview: vi.fn(),
  accountDelete: vi.fn(),
  authorize: vi.fn(),
  send: vi.fn(),
  conversations: vi.fn(),
  contactMembership: vi.fn(),
  workspaces: vi.fn(),
  push: vi.fn(),
  uploads: vi.fn(),
  conversation: vi.fn(),
  messages: vi.fn(),
  download: vi.fn(),
  prefs: vi.fn(),
  updatePrefs: vi.fn(),
  complete: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  transcript: vi.fn(),
  createTemplate: vi.fn(),
  visitorStart: vi.fn(),
  greeting: vi.fn(),
  scopeLookup: vi.fn(),
  rating: vi.fn(),
  translate: vi.fn(),
  translationCapabilities: vi.fn(),
}));
vi.mock("@/lib/account/service", async (original) => ({
  ...(await original<object>()),
  accountDeletionPreview: mocks.accountPreview,
  deleteOwnAccount: mocks.accountDelete,
}));
vi.mock("@/lib/mobile/access", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  authenticateMobile: mocks.authenticate,
  authorizeMobile: mocks.authorize,
}));
vi.mock("@/lib/inbox/queries", () => ({
  sendOperatorMessage: mocks.send,
  fetchConversations: mocks.conversations,
  fetchConversation: mocks.conversation,
  fetchMessages: mocks.messages,
  updateInternalNote: mocks.updateNote,
  softDeleteInternalNote: mocks.deleteNote,
}));
vi.mock("@/lib/workspace/queries", () => ({
  fetchAccessibleWorkspaces: mocks.workspaces,
}));
vi.mock("@/lib/mobile/push", () => ({ mobileService: mocks.push }));
vi.mock("@/lib/attachments/service", () => ({
  completeOperatorUploads: mocks.complete,
  createAttachmentDownloadUrl: mocks.download,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: mocks.uploads,
      maybeSingle: mocks.rating,
    };
    return { from: () => chain };
  },
}));
vi.mock("@/lib/notifications/queries", () => ({
  fetchNotificationPreferences: mocks.prefs,
  updateNotificationPreferences: mocks.updatePrefs,
}));
vi.mock("@/lib/crm/address-book", () => ({
  visitorContactMembership: mocks.contactMembership,
}));
vi.mock("@/lib/conversation-wrapup/transcript", () => ({
  sendConversationTranscript: mocks.transcript,
}));
vi.mock("@/lib/chat-setup/queries", () => ({ fetchChatSetup: mocks.greeting }));
vi.mock("@/lib/workspace/rpc", () => ({ callPublicRpc: mocks.visitorStart }));
vi.mock("@/lib/canned/queries", async (original) => ({
  ...(await original<object>()),
  createCannedResponse: mocks.createTemplate,
}));
vi.mock("@/lib/ai-translation/mobile", () => ({
  mobileTranslate: mocks.translate,
  mobileTranslationCapabilities: mocks.translationCapabilities,
  translationServiceClient: vi.fn(),
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
  delete process.env.MOBILE_VISITOR_PUSH_ENABLED;
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
  expect(await result.json()).toEqual({
    data: {
      apiVersion: 1,
      accountDeletion: true,
      push: false,
      visitorPush: false,
    },
  });
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
    expect(mocks.authorize.mock.calls[0]?.[2]).toBe("manage_internal_notes");
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
    then: (resolve: (value: unknown) => void) => {
      resolve({ error: null });
    },
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

it("loads a chat and history with one authorization", async () => {
  mocks.conversation.mockResolvedValue({ id: conversationId });
  mocks.messages.mockResolvedValue({ items: [] });
  const response = await POST(
    request({
      operation: "chatBootstrap",
      workspaceId,
      input: { conversationId },
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.authorize).toHaveBeenCalledTimes(1);
  expect(mocks.messages).toHaveBeenCalledWith(
    {},
    workspaceId,
    conversationId,
    expect.objectContaining({ limit: 30 }),
  );
});
it("only updates the verified caller's email new-chat preference", async () => {
  mocks.updatePrefs.mockResolvedValue({ email_conversation_new: false });
  expect(
    (
      await POST(
        request({
          operation: "notificationPreferences",
          workspaceId,
          input: { emailConversationNew: false },
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.updatePrefs).toHaveBeenCalledWith({}, workspaceId, {
    email_conversation_new: false,
  });
  expect(
    (
      await POST(
        request({
          operation: "notificationPreferences",
          workspaceId,
          input: { userId: "other", emailConversationNew: true },
        }),
      )
    ).status,
  ).toBe(400);
});
it("never signs a bulk attachment outside the authorized workspace result", async () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => ({
      overrideTypes: () =>
        Promise.resolve({ data: [{ id: conversationId }], error: null }),
    }),
  };
  mocks.authenticate.mockResolvedValue({
    client: { from: () => chain },
    user: { id: "user" },
  });
  mocks.download.mockResolvedValue({
    url: "https://test.invalid/preview",
    expiresAt: "later",
  });
  const response = await POST(
    request({
      operation: "downloads",
      workspaceId,
      input: { attachmentIds: [conversationId, clientMessageId] },
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.download).toHaveBeenCalledWith({
    workspaceId,
    attachmentId: conversationId,
    variant: "thumbnail",
  });
});

it("forwards explicit independent flags only after visitor rollout", async () => {
  process.env.MOBILE_PUSH_ENABLED = "1";
  process.env.MOBILE_VISITOR_PUSH_ENABLED = "1";
  const rpc = vi.fn().mockResolvedValue({ error: null });
  mocks.push.mockReturnValue({ rpc });
  const result = await POST(
    request({
      operation: "registerPush",
      workspaceId,
      input: {
        installationId: clientMessageId,
        token: "ExpoPushToken[valid]",
        pushNewChat: false,
        pushNewVisitor: true,
        pushMessages: false,
      },
    }),
  );
  expect(result.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "register_mobile_push",
    expect.objectContaining({
      p_push_new_chat: false,
      p_push_new_visitor: true,
      p_push_messages: false,
    }),
  );
});
it("does not call the optional preference schema before rollout", async () => {
  process.env.MOBILE_PUSH_ENABLED = "1";
  const result = await POST(
    request({
      operation: "registerPush",
      workspaceId,
      input: {
        installationId: clientMessageId,
        token: "ExpoPushToken[valid]",
        pushNewVisitor: true,
      },
    }),
  );
  expect(result.status).toBe(503);
  expect(mocks.push).not.toHaveBeenCalled();
});
it("reads preferences only for the verified installation, user and workspace member", async () => {
  process.env.MOBILE_PUSH_ENABLED = "1";
  process.env.MOBILE_VISITOR_PUSH_ENABLED = "1";
  const filters: unknown[] = [];
  const chain = {
    select: () => chain,
    eq: (key: string, value: string) => {
      filters.push([key, value]);
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve({
        error: null,
        data: {
          push_new_chat: false,
          push_new_visitor: true,
          push_messages: true,
        },
      }),
  };
  mocks.push.mockReturnValue({ from: () => chain });
  const result = await POST(
    request({
      operation: "pushPreferences",
      workspaceId,
      input: { installationId: clientMessageId },
    }),
  );
  expect(await result.json()).toEqual({
    data: { pushNewChat: false, pushNewVisitor: true, pushMessages: true },
  });
  expect(filters).toEqual([
    ["user_id", "user"],
    ["member_id", "member"],
    ["workspace_id", workspaceId],
    ["installation_id", clientMessageId],
  ]);
});

it.each(["active", "completed"])(
  "passes %s queue to the shared server filter",
  async (statusGroup) => {
    mocks.conversations.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    const response = await POST(
      request({
        operation: "conversations",
        workspaceId,
        input: { statusGroup, page: 1, pageSize: 25 },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.conversations).toHaveBeenCalledWith({}, workspaceId, {
      statusGroup,
      page: 1,
      pageSize: 25,
    });
  },
);

it.each(["contactMembership", "saveContact"])(
  "routes %s through workspace authorization",
  async (operation) => {
    mocks.contactMembership.mockResolvedValue({
      contactId: conversationId,
      saved: true,
    });
    const response = await POST(
      request({
        operation,
        workspaceId,
        input: { visitorSessionId: conversationId },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.contactMembership).toHaveBeenCalledWith(
      {},
      workspaceId,
      { visitorSessionId: conversationId },
      operation === "saveContact",
    );
    expect(mocks.authorize).toHaveBeenCalled();
  },
);

function scopedClient(error: unknown = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: mocks.scopeLookup,
  };
  mocks.scopeLookup.mockResolvedValue({ data: { id: conversationId }, error });
  return { from: () => chain };
}
it("transcript cannot call service for an inaccessible conversation", async () => {
  mocks.authenticate.mockResolvedValue({
    client: scopedClient({ code: "NOT_FOUND" }),
    user: { id: "user" },
  });
  const result = await POST(
    request({
      operation: "transcript",
      workspaceId,
      input: {
        conversationId,
        requestId: clientMessageId,
        email: "qa@example.com",
      },
    }),
  );
  expect(result.status).toBe(404);
  expect(mocks.transcript).not.toHaveBeenCalled();
});
it("transcript retry retains the existing request identity", async () => {
  mocks.authenticate.mockResolvedValue({
    client: scopedClient(),
    user: { id: "user" },
  });
  const payload = {
    operation: "transcript",
    workspaceId,
    input: {
      conversationId,
      requestId: clientMessageId,
      email: "QA@example.com",
    },
  };
  for (let i = 0; i < 2; i++)
    expect((await POST(request(payload))).status).toBe(200);
  expect(mocks.transcript).toHaveBeenNthCalledWith(1, {
    workspaceId,
    conversationId,
    requestId: clientMessageId,
    email: "qa@example.com",
  });
  expect(mocks.transcript).toHaveBeenNthCalledWith(2, {
    workspaceId,
    conversationId,
    requestId: clientMessageId,
    email: "qa@example.com",
  });
});
it.each([
  ["transcript", { conversationId, requestId: clientMessageId, email: "bad" }],
  [
    "transcript",
    {
      conversationId: "bad",
      requestId: clientMessageId,
      email: "qa@example.com",
    },
  ],
  [
    "startVisitorChat",
    { visitorId: conversationId, requestId: clientMessageId, message: "" },
  ],
  [
    "startVisitorChat",
    { visitorId: conversationId, requestId: "bad", message: "Hello" },
  ],
  ["visitorGreeting", { unexpected: true }],
])("invalid %s input cannot reach side effects", async (operation, input) => {
  expect((await POST(request({ operation, workspaceId, input }))).status).toBe(
    400,
  );
  expect(mocks.transcript).not.toHaveBeenCalled();
  expect(mocks.visitorStart).not.toHaveBeenCalled();
  expect(mocks.greeting).not.toHaveBeenCalled();
});
it("team template creation is denied for agents before its RPC", async () => {
  mocks.authorize.mockResolvedValue({
    memberId: "member",
    workspace: { role: "agent" },
  });
  expect(
    (
      await POST(
        request({
          operation: "createTemplate",
          workspaceId,
          input: { title: "Greeting", body: "Hello", visibility: "workspace" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.createTemplate).not.toHaveBeenCalled();
});
it("agent can create a personal template using the shared RPC", async () => {
  mocks.authorize.mockResolvedValue({
    memberId: "member",
    workspace: { role: "agent" },
  });
  mocks.createTemplate.mockResolvedValue({ id: clientMessageId });
  expect(
    (
      await POST(
        request({
          operation: "createTemplate",
          workspaceId,
          input: { title: "Greeting", body: "Hello", visibility: "personal" },
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.createTemplate).toHaveBeenCalled();
});
it("visitor chat retry preserves the client message UUID", async () => {
  mocks.visitorStart.mockResolvedValue({
    data: { conversationId },
    error: null,
  });
  const input = {
    visitorId: conversationId,
    requestId: clientMessageId,
    message: "Hello",
  };
  expect(
    (await POST(request({ operation: "startVisitorChat", workspaceId, input })))
      .status,
  ).toBe(200);
  expect(mocks.visitorStart).toHaveBeenCalledWith({}, "start_visitor_chat", {
    p_workspace_id: workspaceId,
    p_visitor_session_id: conversationId,
    p_body: "Hello",
    p_client_message_id: clientMessageId,
  });
});

it("feedback read denies inaccessible conversations before its service query", async () => {
  mocks.authenticate.mockResolvedValue({
    client: scopedClient({ code: "NOT_FOUND" }),
    user: { id: "user" },
  });
  expect(
    (
      await POST(
        request({
          operation: "rating",
          workspaceId,
          input: { conversationId },
        }),
      )
    ).status,
  ).toBe(404);
  expect(mocks.rating).not.toHaveBeenCalled();
});
it("feedback read returns only the selected rating fields", async () => {
  mocks.authenticate.mockResolvedValue({
    client: scopedClient(),
    user: { id: "user" },
  });
  mocks.rating.mockResolvedValue({
    data: { score: 5, comment: "Helpful", created_at: "2026-10-08T12:00:00Z" },
    error: null,
  });
  const result = await POST(
    request({ operation: "rating", workspaceId, input: { conversationId } }),
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    data: { score: 5, comment: "Helpful", created_at: "2026-10-08T12:00:00Z" },
  });
});
it("greeting reads use an explicit capability and return no other settings", async () => {
  mocks.greeting.mockResolvedValue({
    config: { invitationMessage: "Welcome", privateSetting: "excluded" },
  });
  const result = await POST(
    request({ operation: "visitorGreeting", workspaceId, input: {} }),
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    data: { invitationMessage: "Welcome" },
  });
  expect(mocks.authorize).toHaveBeenCalledWith(
    expect.anything(),
    workspaceId,
    "view_conversations",
  );
});

it("account preview is scoped to the authenticated account without a company", async () => {
  mocks.accountPreview.mockResolvedValue({
    email: "self@test.invalid",
    personalCompanies: [],
    sharedCompanies: [],
    blockers: [],
  });
  const result = await POST(
    request({ operation: "accountDeletionPreview", input: {} }),
  );
  expect(result.status).toBe(200);
  expect(mocks.accountPreview).toHaveBeenCalledTimes(1);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
it("own deletion passes confirmation to the account-scoped service without a workspace", async () => {
  mocks.accountDelete.mockResolvedValue({ deleted: true });
  const input = {
    confirmation: "self@test.invalid",
    password: "fixture-password",
  };
  const result = await POST(request({ operation: "deleteOwnAccount", input }));
  expect(await result.json()).toEqual({ data: { deleted: true } });
  expect(mocks.accountDelete).toHaveBeenCalledWith(expect.anything(), input);
  expect(mocks.authorize).not.toHaveBeenCalled();
});

it.each(["translateMessage", "previewReplyTranslation"])(
  "%s uses the translation service's fresh authorization without duplicate workspace fetching",
  async (operation) => {
    mocks.translate.mockResolvedValue({ translatedText: "Hello" });
    const input = { conversationId, consent: true };
    const result = await POST(request({ operation, workspaceId, input }));
    expect(result.status).toBe(200);
    expect(mocks.translate).toHaveBeenCalledWith(
      { client: {}, user: { id: "user" } }, workspaceId, operation, input,
    );
    expect(mocks.authorize).not.toHaveBeenCalled();
  },
);
it("unauthenticated translation cannot reach the provider service", async () => {
  mocks.authenticate.mockRejectedValue(new MobileError(401, "UNAUTHORIZED", "Sign in"));
  const result = await POST(request({ operation: "translateMessage", workspaceId, input: {} }));
  expect(result.status).toBe(401);
  expect(mocks.translate).not.toHaveBeenCalled();
});
it("translation cannot run without an explicit workspace", async () => {
  const result = await POST(request({ operation: "translateMessage", input: {} }));
  expect(result.status).toBe(400);
  expect(mocks.translate).not.toHaveBeenCalled();
});
it("translation originals retain workspace view authorization", async () => {
  mocks.authorize.mockRejectedValue(new MobileError(403, "FORBIDDEN", "Denied"));
  const result = await POST(request({ operation: "translationOriginals", workspaceId, input: { conversationId } }));
  expect(result.status).toBe(403);
  expect(mocks.authorize).toHaveBeenCalledWith(
    { client: {}, user: { id: "user" } }, workspaceId, "view_conversations",
  );
});
