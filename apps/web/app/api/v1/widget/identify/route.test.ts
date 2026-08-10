import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_VALIDATION_MESSAGE } from "@/lib/widget/responses";

const verifyEmbedContext = vi.fn();
const consumeWidgetRateLimit = vi.fn();
const identifyVisitor = vi.fn();

vi.mock("@/lib/widget/context", () => ({
  verifyEmbedContext,
  corsOriginFromEmbed: (origin: string) => origin,
}));

vi.mock("@/lib/widget/service", () => ({
  consumeWidgetRateLimit,
  identifyVisitor,
}));

const { POST } = await import("./route");

describe("widget identify route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-json content types", async () => {
    const request = new Request(
      "http://localhost:3000/api/v1/widget/identify",
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: "Bearer session-token",
        },
        body: "not-json",
      },
    );

    const response = await POST(request);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe(GENERIC_VALIDATION_MESSAGE);
    expect(verifyEmbedContext).not.toHaveBeenCalled();
  });

  it("identifies a visitor with normalized fields", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "http://localhost:4173",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    identifyVisitor.mockResolvedValue({
      visitorPublicId: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Ada Lovelace",
      email: "ada@Example.com",
      phone: "+1 555 0100",
      attributes: { plan: "pro" },
    });

    const request = new Request(
      "http://localhost:3000/api/v1/widget/identify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:4173",
          Authorization: "Bearer session-token",
        },
        body: JSON.stringify({
          embedToken: "embed-token",
          name: "Ada Lovelace",
          email: "ada@Example.com",
          phone: "+1 555 0100",
          attributes: { plan: "pro" },
        }),
      },
    );

    const response = await POST(request);
    const body = (await response.json()) as {
      data: { visitorPublicId: string; name: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.data.visitorPublicId).toBe(
      "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(identifyVisitor).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sessionToken: "session-token",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+1 555 0100",
        phoneE164: "+15550100",
        attributes: { plan: "pro" },
      }),
    );
  });
});
