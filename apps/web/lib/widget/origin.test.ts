import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRequestOrigin,
  isDevLocalOrigin,
  requestOriginMatchesEmbed,
} from "@/lib/widget/origin";

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

  it("requestOriginMatchesEmbed allows parentOrigin and iframe API origin", () => {
    const parent = "https://customer.example";
    const api = "https://app.sitechat.example";

    expect(
      requestOriginMatchesEmbed(
        new Request(`${api}/api/v1/widget/session`, {
          headers: { Origin: parent },
        }),
        parent,
      ),
    ).toBe(true);

    expect(
      requestOriginMatchesEmbed(
        new Request(`${api}/api/v1/widget/session`, {
          headers: { Origin: api },
        }),
        parent,
      ),
    ).toBe(true);

    expect(
      requestOriginMatchesEmbed(
        new Request(`${api}/api/v1/widget/session`, {
          headers: { Origin: "https://evil.example" },
        }),
        parent,
      ),
    ).toBe(false);

    expect(
      requestOriginMatchesEmbed(
        new Request(`${api}/api/v1/widget/session`),
        parent,
      ),
    ).toBe(true);
  });
});
