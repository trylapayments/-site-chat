import { describe, expect, it } from "vitest";

import {
  buildPageContext,
  parseUtmFromUrl,
  sanitizePageUrl,
  shouldRecordPageView,
} from "./page-context";

describe("sanitizePageUrl", () => {
  it("accepts http(s) urls", () => {
    expect(sanitizePageUrl("https://example.com/pricing?x=1")).toBe(
      "https://example.com/pricing?x=1",
    );
  });

  it("rejects javascript and data urls", () => {
    expect(sanitizePageUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePageUrl("data:text/html,hi")).toBeNull();
  });

  it("strips credentials", () => {
    expect(sanitizePageUrl("https://user:pass@example.com/a")).toBe("https://example.com/a");
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
});

describe("buildPageContext", () => {
  it("builds sanitized context", () => {
    const ctx = buildPageContext({
      url: "https://example.com/app?utm_source=newsletter",
      title: "  Pricing <script>  ",
      referrer: "https://google.com/",
    });
    expect(ctx.url).toBe("https://example.com/app?utm_source=newsletter");
    expect(ctx.title).toBe("Pricing <script>");
    expect(ctx.utmSource).toBe("newsletter");
    expect(ctx.landingUrl).toBe(ctx.url);
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
});
