import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_VALIDATION_MESSAGE } from "@/lib/widget/responses";

const verifyEmbedContext = vi.fn();
const consumeWidgetRateLimit = vi.fn();
const recordPageView = vi.fn();

vi.mock("@/lib/widget/context", () => ({
  verifyEmbedContext,
  corsOriginFromEmbed: (origin: string) => origin,
}));

vi.mock("@/lib/widget/service", () => ({
  consumeWidgetRateLimit,
  recordPageView,
}));

const { POST } = await import("./route");

describe("widget page-view route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-json content types", async () => {
    const request = new Request(
      "http://localhost:3000/api/v1/widget/page-view",
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
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string };
    };
    expect(body.error.message).toBe(GENERIC_VALIDATION_MESSAGE);
  });

  it("records a page view with sanitized url and utm", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "http://localhost:4173",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    recordPageView.mockResolvedValue({
      recorded: true,
      deduped: false,
      currentUrl: "https://customer.example.com/pricing?utm_source=ads",
      currentTitle: "Pricing",
    });

    const request = new Request(
      "http://localhost:3000/api/v1/widget/page-view",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:4173",
          Authorization: "Bearer session-token",
        },
        body: JSON.stringify({
          embedToken: "embed-token",
          url: "https://customer.example.com/pricing?utm_source=ads",
          title: "Pricing",
          referrer: "https://google.com/",
        }),
      },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(recordPageView).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sessionToken: "session-token",
        url: "https://customer.example.com/pricing?utm_source=ads",
        title: "Pricing",
        utmSource: "ads",
      }),
    );
  });

  it("forwards an optional tabId to recordPageView", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "http://localhost:4173",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    recordPageView.mockResolvedValue({
      recorded: true,
      deduped: false,
      currentUrl: "https://customer.example.com/pricing",
      currentTitle: "Pricing",
    });

    const request = new Request(
      "http://localhost:3000/api/v1/widget/page-view",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:4173",
          Authorization: "Bearer session-token",
        },
        body: JSON.stringify({
          embedToken: "embed-token",
          url: "https://customer.example.com/pricing",
          tabId: "tab-1",
        }),
      },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(recordPageView).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "tab-1",
      }),
    );
  });

  it("denies requests whose Origin does not match the embed's parentOrigin", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "https://customer.example.com",
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const request = new Request(
      "http://localhost:3000/api/v1/widget/page-view",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example.com",
          Authorization: "Bearer session-token",
        },
        body: JSON.stringify({
          embedToken: "embed-token",
          url: "https://customer.example.com/pricing",
        }),
      },
    );

    const response = await POST(request);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(consumeWidgetRateLimit).not.toHaveBeenCalled();
    expect(recordPageView).not.toHaveBeenCalled();
  });
});
