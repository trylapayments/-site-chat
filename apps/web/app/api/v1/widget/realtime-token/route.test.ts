import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_INTERNAL_MESSAGE } from "@/lib/widget/responses";

const verifyEmbedContext = vi.fn();
const consumeWidgetRateLimit = vi.fn();
const resolveWidgetRealtimeTopic = vi.fn();

vi.mock("@/lib/widget/context", () => ({
  verifyEmbedContext,
}));

vi.mock("@/lib/widget/service", () => ({
  consumeWidgetRateLimit,
  resolveWidgetRealtimeTopic,
}));

const { POST } = await import("./route");

describe("widget realtime-token route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a generic 500 with CORS when an unexpected failure occurs and Origin is present", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "http://localhost:4173",
      widgetPublicKey: "wpk_test123456789012345678901234567890",
      workspace: {
        workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        widgetPublicKey: "wpk_test123456789012345678901234567890",
        config: {},
      },
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    resolveWidgetRealtimeTopic.mockRejectedValue(
      new Error("database unavailable"),
    );

    const request = new Request(
      "http://localhost:3000/api/v1/widget/realtime-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:4173",
          Authorization: "Bearer session-token",
        },
        body: JSON.stringify({ embedToken: "embed-token" }),
      },
    );

    const response = await POST(request);
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:4173",
    );
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe(GENERIC_INTERNAL_MESSAGE);
    expect(body.error.message).not.toContain("database");
    expect(JSON.stringify(body)).not.toContain("database unavailable");
  });

  it("returns a generic 500 without CORS when Origin is missing", async () => {
    verifyEmbedContext.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentOrigin: "http://localhost:4173",
      widgetPublicKey: "wpk_test123456789012345678901234567890",
      workspace: {
        workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        widgetPublicKey: "wpk_test123456789012345678901234567890",
        config: {},
      },
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
    resolveWidgetRealtimeTopic.mockRejectedValue(
      new Error("database unavailable"),
    );

    const request = new Request(
      "http://localhost:3000/api/v1/widget/realtime-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer session-token",
        },
        body: JSON.stringify({ embedToken: "embed-token" }),
      },
    );

    const response = await POST(request);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe(GENERIC_INTERNAL_MESSAGE);
  });
});
