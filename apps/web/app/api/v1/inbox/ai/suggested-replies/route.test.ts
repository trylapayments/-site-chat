import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireUser,
  getWorkspaceContext,
  createClient,
  streamSuggestedReply,
  requireCapability,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getWorkspaceContext: vi.fn(),
  createClient: vi.fn(),
  streamSuggestedReply: vi.fn(),
  requireCapability: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser,
}));

vi.mock("@/lib/workspace/redirect.server", () => ({
  getWorkspaceContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient,
}));

vi.mock("@/lib/ai/suggested-replies", () => ({
  streamSuggestedReply,
}));

vi.mock("@/lib/permissions/require-capability", async () => {
  const actual = await vi.importActual("@/lib/permissions/require-capability");
  return {
    ...(actual as object),
    requireCapability,
  };
});

const { POST } = await import("./route");
const { CapabilityError } =
  await import("@/lib/permissions/require-capability");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";

function jsonRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/v1/inbox/ai/suggested-replies",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

function memberLookupClient(memberId: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: memberId ? { id: memberId } : null,
              }),
          }),
        }),
      }),
    }),
  };
}

describe("suggested replies route authorization and hardening", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-JSON content types before buffering a body", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/v1/inbox/ai/suggested-replies", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "x".repeat(100),
      }),
    );

    expect(response.status).toBe(415);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies with a typed error", async () => {
    const response = await POST(jsonRequest(`{"a":"${"x".repeat(9000)}"}`));
    expect(response.status).toBe(413);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("AI_INVALID_RESPONSE");
    expect(body.error.message).toMatch(/too large/i);
  });

  it("denies an authenticated member of another workspace", async () => {
    requireUser.mockResolvedValue({
      user: { id: "user-1", email: "agent@example.com" },
    });
    createClient.mockResolvedValue(memberLookupClient("member-1"));
    getWorkspaceContext.mockResolvedValue({
      membership: {
        accessible_workspaces: [
          {
            workspace_id: workspaceId,
            name: "Own WS",
            role: "agent",
          },
        ],
      },
    });

    const response = await POST(
      jsonRequest({
        workspaceId: otherWorkspaceId,
        conversationId,
      }),
    );

    expect(response.status).toBe(403);
    expect(streamSuggestedReply).not.toHaveBeenCalled();
  });

  it("denies viewer role without send_messages", async () => {
    requireUser.mockResolvedValue({
      user: { id: "user-1", email: "viewer@example.com" },
    });
    createClient.mockResolvedValue({});
    getWorkspaceContext.mockResolvedValue({
      membership: {
        accessible_workspaces: [
          {
            workspace_id: workspaceId,
            name: "Own WS",
            role: "viewer",
          },
        ],
      },
    });
    requireCapability.mockImplementation(() => {
      throw new CapabilityError("viewer", "send_messages");
    });

    const response = await POST(
      jsonRequest({
        workspaceId,
        conversationId,
      }),
    );

    expect(response.status).toBe(403);
    expect(streamSuggestedReply).not.toHaveBeenCalled();
  });

  it("allows a valid operator in the correct workspace to start a stream", async () => {
    requireUser.mockResolvedValue({
      user: { id: "user-1", email: "agent@example.com" },
    });
    createClient.mockResolvedValue(memberLookupClient("member-1"));
    getWorkspaceContext.mockResolvedValue({
      membership: {
        accessible_workspaces: [
          {
            workspace_id: workspaceId,
            name: "Own WS",
            role: "agent",
          },
        ],
      },
    });
    requireCapability.mockImplementation(() => undefined);
    streamSuggestedReply.mockImplementation(function* () {
      yield {
        type: "done" as const,
        suggestion: "Hello",
        model: "mock",
        provider: "mock" as const,
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
        },
      };
    });

    const response = await POST(
      jsonRequest({
        workspaceId,
        conversationId,
        regenerate: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(streamSuggestedReply).toHaveBeenCalledOnce();
    const auth = streamSuggestedReply.mock.calls[0]?.[1] as {
      regenerate?: boolean;
      operatorDisplayName?: string;
      regenerateNonce?: string;
    };
    expect(auth.regenerate).toBe(true);
    expect(auth).not.toHaveProperty("operatorDisplayName");
    expect(auth).not.toHaveProperty("regenerateNonce");
  });
});
