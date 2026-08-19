import {
  defaultWidgetAppearanceConfig,
  mapAppearanceToPublicConfig,
} from "@site-chat/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveBootstrapContext, consumeWidgetRateLimit } = vi.hoisted(() => ({
  resolveBootstrapContext: vi.fn(),
  consumeWidgetRateLimit: vi.fn(),
}));

vi.mock("@/lib/widget/context", () => ({
  resolveBootstrapContext,
}));

vi.mock("@/lib/widget/service", () => ({
  consumeWidgetRateLimit,
}));

vi.mock("@/lib/widget-studio/public-config", () => ({
  widgetPublicConfigEtag: (key: string, version: number) =>
    `"widget-config-${key}-v${String(version)}-s123"`,
  widgetPublicConfigCacheControl: () =>
    "public, max-age=60, stale-while-revalidate=60",
}));

const { GET } = await import("@/app/api/v1/widget/config/route");

const widgetPublicKey = "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const config = mapAppearanceToPublicConfig({
  config: defaultWidgetAppearanceConfig(),
  publishedVersion: 4,
  publishedAt: "2026-08-19T10:00:00.000Z",
});

describe("widget public config route", () => {
  beforeEach(() => {
    resolveBootstrapContext.mockResolvedValue({
      ok: true,
      parentOrigin: "https://customer.example.com",
      workspace: {
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        widgetPublicKey,
        config,
      },
    });
    consumeWidgetRateLimit.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the expanded public appearance with cache headers", async () => {
    const response = await GET(
      new Request(
        `http://localhost:3000/api/v1/widget/config?key=${widgetPublicKey}`,
        { headers: { Origin: "https://customer.example.com" } },
      ),
    );
    const body = (await response.json()) as {
      data: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=60",
    );
    expect(response.headers.get("etag")).toBe(
      `"widget-config-${widgetPublicKey}-v4-s123"`,
    );
    expect(body.data.version).toBe(4);
    expect(body.data.primaryColor).toBe("#0066FF");
    expect(body.data).not.toHaveProperty("embedToken");
  });

  it("returns 304 when the published version ETag matches", async () => {
    const response = await GET(
      new Request(
        `http://localhost:3000/api/v1/widget/config?key=${widgetPublicKey}`,
        {
          headers: {
            Origin: "https://customer.example.com",
            "If-None-Match": `"widget-config-${widgetPublicKey}-v4-s123"`,
          },
        },
      ),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://customer.example.com",
    );
  });
});
