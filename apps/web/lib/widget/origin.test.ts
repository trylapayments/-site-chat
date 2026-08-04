import { afterEach, describe, expect, it, vi } from "vitest";

import { getRequestOrigin, isDevLocalOrigin } from "@/lib/widget/origin";

describe("widget request origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires Origin in production-like environments", () => {
    vi.stubEnv("NODE_ENV", "production");

    const request = new Request("https://example.com/api/v1/widget/bootstrap", {
      headers: {
        Referer: "https://customer.example/page",
      },
    });

    expect(getRequestOrigin(request)).toBeNull();
  });

  it("allows localhost Referer fallback only in development", () => {
    vi.stubEnv("NODE_ENV", "development");

    const request = new Request("https://example.com/api/v1/widget/bootstrap", {
      headers: {
        Referer: "http://localhost:4173/page",
      },
    });

    expect(getRequestOrigin(request)).toBe("http://localhost:4173");
    expect(isDevLocalOrigin("http://localhost:4173")).toBe(true);
  });
});
