import { describe, expect, it } from "vitest";

import {
  buildPageContext,
  parseUtmFromUrl,
  sanitizePageUrl,
  sanitizeReferrer,
  shouldRecordPageView,
} from "./page-context";

describe("sanitizePageUrl", () => {
  it("accepts http(s) urls", () => {
    expect(sanitizePageUrl("https://example.com/pricing")).toBe("https://example.com/pricing");
  });

  it("rejects javascript, data, and vbscript urls", () => {
    expect(sanitizePageUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePageUrl("data:text/html,hi")).toBeNull();
    expect(sanitizePageUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(sanitizePageUrl("ftp://example.com/a")).toBeNull();
    expect(sanitizePageUrl("mailto:someone@example.com")).toBeNull();
  });

  it("strips credentials", () => {
    expect(sanitizePageUrl("https://user:pass@example.com/a")).toBe("https://example.com/a");
  });

  it("strips the hash fragment entirely", () => {
    expect(sanitizePageUrl("https://example.com/pricing#section-2")).toBe(
      "https://example.com/pricing",
    );
  });

  it("strips OAuth callback secrets (code/state) while keeping origin + path", () => {
    expect(sanitizePageUrl("https://example.com/auth/callback?code=abc123&state=xyz789")).toBe(
      "https://example.com/auth/callback",
    );
  });

  it("strips password-reset and magic-link tokens", () => {
    expect(sanitizePageUrl("https://example.com/reset-password?token=supersecret")).toBe(
      "https://example.com/reset-password",
    );
    expect(sanitizePageUrl("https://example.com/magic-link?token=abc&email=jane@example.com")).toBe(
      "https://example.com/magic-link",
    );
  });

  it("preserves only allowlisted UTM params from an ordinary marketing URL", () => {
    expect(
      sanitizePageUrl(
        "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&utm_term=chat",
      ),
    ).toBe(
      "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&utm_term=chat",
    );
  });

  it("strips non-UTM query params while keeping UTM params", () => {
    expect(sanitizePageUrl("https://example.com/?foo=1&utm_source=x&bar=2")).toBe(
      "https://example.com/?utm_source=x",
    );
  });

  it("drops the query string entirely when no UTM params are present", () => {
    expect(sanitizePageUrl("https://example.com/pricing?ref=abc&session=123")).toBe(
      "https://example.com/pricing",
    );
  });

  it("defaults an empty path to /", () => {
    expect(sanitizePageUrl("https://example.com")).toBe("https://example.com/");
  });

  it("bounds length to VISITOR_URL_MAX_LENGTH", () => {
    const longPath = `/${"a".repeat(3000)}`;
    const result = sanitizePageUrl(`https://example.com${longPath}`);
    expect(typeof result).toBe("string");
    expect((result ?? "").length).toBeLessThanOrEqual(2048);
  });

  it("returns null for non-string or empty input", () => {
    expect(sanitizePageUrl(null)).toBeNull();
    expect(sanitizePageUrl(undefined)).toBeNull();
    expect(sanitizePageUrl(123)).toBeNull();
    expect(sanitizePageUrl("   ")).toBeNull();
  });
});

describe("sanitizeReferrer", () => {
  it("applies the same privacy policy as sanitizePageUrl for absolute referrers", () => {
    expect(sanitizeReferrer("https://google.com/search?q=widgets&utm_source=serp")).toBe(
      "https://google.com/search?utm_source=serp",
    );
  });

  it("strips credentials and fragment from referrers", () => {
    expect(sanitizeReferrer("https://user:pass@example.com/a#frag")).toBe("https://example.com/a");
  });

  it("rejects script schemes even for opaque referrers", () => {
    expect(sanitizeReferrer("javascript:alert(1)")).toBeNull();
    expect(sanitizeReferrer("data:text/html,hi")).toBeNull();
  });

  it("clamps opaque non-URL referrers to the bounded length", () => {
    const opaque = "a".repeat(3000);
    const result = sanitizeReferrer(opaque);
    expect(typeof result).toBe("string");
    expect((result ?? "").length).toBeLessThanOrEqual(2048);
  });

  it("returns null for empty referrer", () => {
    expect(sanitizeReferrer("")).toBeNull();
    expect(sanitizeReferrer(null)).toBeNull();
  });
});

describe("parseUtmFromUrl", () => {
  it("extracts utm params", () => {
    expect(
      parseUtmFromUrl(
        "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&utm_term=chat",
      ),
    ).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring",
      utmContent: "ad1",
      utmTerm: "chat",
    });
  });

  it("returns null fields for a sanitized url with no utm params", () => {
    expect(parseUtmFromUrl("https://example.com/pricing")).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });
  });

  it("returns null fields for null input", () => {
    expect(parseUtmFromUrl(null)).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });
  });
});

describe("buildPageContext", () => {
  it("builds sanitized context, keeping only the utm query", () => {
    const ctx = buildPageContext({
      url: "https://example.com/app?utm_source=newsletter&session=abc",
      title: "  Pricing <script>  ",
      referrer: "https://google.com/",
    });
    expect(ctx.url).toBe("https://example.com/app?utm_source=newsletter");
    expect(ctx.title).toBe("Pricing <script>");
    expect(ctx.utmSource).toBe("newsletter");
    expect(ctx.landingUrl).toBe(ctx.url);
  });

  it("strips OAuth callback secrets end-to-end", () => {
    const ctx = buildPageContext({
      url: "https://example.com/auth/callback?code=abc123&state=xyz789#done",
    });
    expect(ctx.url).toBe("https://example.com/auth/callback");
    expect(ctx.utmSource).toBeNull();
  });
});

describe("shouldRecordPageView", () => {
  it("dedupes identical urls", () => {
    expect(
      shouldRecordPageView({
        previousUrl: "https://example.com/a",
        nextUrl: "https://example.com/a",
      }),
    ).toBe(false);
  });

  it("records path changes", () => {
    expect(
      shouldRecordPageView({
        previousUrl: "https://example.com/a",
        nextUrl: "https://example.com/b",
      }),
    ).toBe(true);
  });

  it("ignores hash-only changes by default", () => {
    expect(
      shouldRecordPageView({
        previousUrl: "https://example.com/a#one",
        nextUrl: "https://example.com/a#two",
      }),
    ).toBe(false);
  });

  it("records hash changes when enabled", () => {
    expect(
      shouldRecordPageView({
        previousUrl: "https://example.com/a#one",
        nextUrl: "https://example.com/a#two",
        hashIsNavigation: true,
      }),
    ).toBe(true);
  });

  it("dedupes sanitized urls that never carried a hash in the first place", () => {
    const previousUrl = sanitizePageUrl("https://example.com/a#one");
    const nextUrl = sanitizePageUrl("https://example.com/a#two");
    if (previousUrl === null || nextUrl === null) {
      throw new Error("expected sanitizePageUrl to return a non-null value");
    }
    expect(shouldRecordPageView({ previousUrl, nextUrl })).toBe(false);
  });
});
