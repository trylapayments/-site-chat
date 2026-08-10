import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_VALIDATION_MESSAGE } from "@/lib/widget/responses";

const verifyEmbedContext = vi.fn();
const consumeWidgetRateLimit = vi.fn();
const createOrResumeVisitorSession = vi.fn();

vi.mock("@/lib/widget/context", () => ({
  verifyEmbedContext,
  corsOriginFromEmbed: (origin: string) => origin,
}));

vi.mock("@/lib/widget/service", () => ({
  consumeWidgetRateLimit,
  createOrResumeVisitorSession,
}));

const { POST } = await import("./route");

describe("widget session route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-json content types", async () => {
    const request = new Request("http://localhost:3000/api/v1/widget/session", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: "not-json",
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe(GENERIC_VALIDATION_MESSAGE);
    expect(verifyEmbedContext).not.toHaveBeenCalled();
  });

  it("creates a session and forwards continuityToken", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "http://localhost:4173",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    createOrResumeVisitorSession.mockResolvedValue({
      sessionToken: "session-token",
      expiresAt: new Date().toISOString(),
      locale: "en",
      hasConversation: false,
      conversationStatus: null,
      visitorPublicId: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      continuityToken: null,
    });

    const request = new Request("http://localhost:3000/api/v1/widget/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4173",
      },
      body: JSON.stringify({
        embedToken: "embed-token",
        continuityToken: "abcdefghijklmnopqrst",
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      data: { sessionToken: string; visitorPublicId: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.data.sessionToken).toBe("session-token");
    expect(createOrResumeVisitorSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        continuityToken: "abcdefghijklmnopqrst",
      }),
    );
  });

  it("denies requests whose Origin does not match the embed's parentOrigin", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "https://customer.example.com",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const request = new Request("http://localhost:3000/api/v1/widget/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({
        embedToken: "embed-token",
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(consumeWidgetRateLimit).not.toHaveBeenCalled();
    expect(createOrResumeVisitorSession).not.toHaveBeenCalled();
  });

  it("allows requests with no Origin header (non-browser clients)", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "https://customer.example.com",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    createOrResumeVisitorSession.mockResolvedValue({
      sessionToken: "session-token",
      expiresAt: new Date().toISOString(),
      locale: "en",
      hasConversation: false,
      conversationStatus: null,
      visitorPublicId: null,
      continuityToken: null,
    });

    const request = new Request("http://localhost:3000/api/v1/widget/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embedToken: "embed-token",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(createOrResumeVisitorSession).toHaveBeenCalled();
  });
});
