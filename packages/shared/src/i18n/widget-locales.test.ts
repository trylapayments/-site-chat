import { describe, expect, it } from "vitest";

import {
  DEFAULT_WIDGET_LOCALE,
  getWidgetDirection,
  isWidgetLocale,
  matchWidgetLocale,
  normalizeLocaleTag,
  resolveWidgetLocale,
  RTL_WIDGET_LOCALES,
  WIDGET_LOCALE_CODES,
  WIDGET_LOCALE_DEFINITIONS,
  WIDGET_LOCALE_SOURCE,
} from "./index";

describe("widget locale registry", () => {
  it("matches the verified LiveChat language count", () => {
    expect(WIDGET_LOCALE_SOURCE.officialLanguageCount).toBe(48);
    expect(WIDGET_LOCALE_DEFINITIONS).toHaveLength(48);
    expect(WIDGET_LOCALE_CODES).toHaveLength(48);
  });

  it("has unique canonical codes and keys", () => {
    const codes = WIDGET_LOCALE_DEFINITIONS.map((locale) => locale.code);
    const keys = WIDGET_LOCALE_DEFINITIONS.map((locale) => locale.key);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks Arabic, Hebrew, and Persian as RTL only", () => {
    expect(RTL_WIDGET_LOCALES).toEqual(["ar", "fa", "he"]);
    expect(getWidgetDirection("ar")).toBe("rtl");
    expect(getWidgetDirection("he")).toBe("rtl");
    expect(getWidgetDirection("fa")).toBe("rtl");
    expect(getWidgetDirection("en")).toBe("ltr");
    expect(getWidgetDirection("ru")).toBe("ltr");
  });

  it("includes mandatory Russian and Hebrew", () => {
    expect(isWidgetLocale("ru")).toBe(true);
    expect(isWidgetLocale("he")).toBe(true);
  });

  it("distinguishes Chinese, Portuguese, and Norwegian variants", () => {
    expect(isWidgetLocale("zh-CN")).toBe(true);
    expect(isWidgetLocale("zh-TW")).toBe(true);
    expect(isWidgetLocale("pt-PT")).toBe(true);
    expect(isWidgetLocale("pt-BR")).toBe(true);
    expect(isWidgetLocale("nb")).toBe(true);
    expect(isWidgetLocale("nn")).toBe(true);
  });
});

describe("normalizeLocaleTag", () => {
  it("normalizes case and underscores", () => {
    expect(normalizeLocaleTag("en_GB")).toBe("en-gb");
    expect(normalizeLocaleTag(" PT-br ")).toBe("pt-br");
  });
});

describe("matchWidgetLocale", () => {
  it("matches browser aliases", () => {
    expect(matchWidgetLocale("en-GB")).toBe("en");
    expect(matchWidgetLocale("en_US")).toBe("en");
    expect(matchWidgetLocale("pt-BR")).toBe("pt-BR");
    expect(matchWidgetLocale("pt-PT")).toBe("pt-PT");
    expect(matchWidgetLocale("pt")).toBe("pt-PT");
    expect(matchWidgetLocale("zh-CN")).toBe("zh-CN");
    expect(matchWidgetLocale("zh-Hans")).toBe("zh-CN");
    expect(matchWidgetLocale("zh-TW")).toBe("zh-TW");
    expect(matchWidgetLocale("zh-Hant")).toBe("zh-TW");
    expect(matchWidgetLocale("he")).toBe("he");
    expect(matchWidgetLocale("he-IL")).toBe("he");
    expect(matchWidgetLocale("iw")).toBe("he");
    expect(matchWidgetLocale("ru")).toBe("ru");
    expect(matchWidgetLocale("ru-RU")).toBe("ru");
    expect(matchWidgetLocale("no")).toBe("nb");
    expect(matchWidgetLocale("nn-NO")).toBe("nn");
  });

  it("returns null for unknown tags", () => {
    expect(matchWidgetLocale("xx")).toBeNull();
    expect(matchWidgetLocale("")).toBeNull();
    expect(matchWidgetLocale(null)).toBeNull();
    expect(matchWidgetLocale(undefined)).toBeNull();
  });
});

describe("resolveWidgetLocale", () => {
  it("prefers config locale", () => {
    expect(
      resolveWidgetLocale({
        configLocale: "he",
        browserLanguages: ["ru", "en"],
        browserLocale: "ru",
      }),
    ).toBe("he");
  });

  it("uses embed override when config is absent", () => {
    expect(
      resolveWidgetLocale({
        embedLocale: "ru",
        browserLanguages: ["he"],
      }),
    ).toBe("ru");
  });

  it("walks browserLanguages in priority order", () => {
    expect(
      resolveWidgetLocale({
        browserLanguages: ["xx-YY", "pt-BR", "en"],
        browserLocale: "en",
      }),
    ).toBe("pt-BR");
  });

  it("falls back to navigator.language", () => {
    expect(
      resolveWidgetLocale({
        browserLanguages: ["xx"],
        browserLocale: "he-IL",
      }),
    ).toBe("he");
  });

  it("falls back to English", () => {
    expect(resolveWidgetLocale({})).toBe(DEFAULT_WIDGET_LOCALE);
    expect(
      resolveWidgetLocale({
        configLocale: "not-a-locale",
        browserLanguages: ["zz"],
        browserLocale: "yy",
      }),
    ).toBe("en");
  });

  it("never throws on malformed input", () => {
    expect(
      resolveWidgetLocale({
        configLocale: 123 as unknown as string,
        browserLanguages: [null as unknown as string, "", "  "],
        browserLocale: { toString: () => "boom" } as unknown as string,
      }),
    ).toBe("en");
  });

  it("resolves Russian and Hebrew from aliases", () => {
    expect(resolveWidgetLocale({ browserLocale: "ru_RU" })).toBe("ru");
    expect(resolveWidgetLocale({ browserLocale: "he_IL" })).toBe("he");
  });

  it("accepts legacy en/ru config values", () => {
    expect(resolveWidgetLocale({ configLocale: "en" })).toBe("en");
    expect(resolveWidgetLocale({ configLocale: "ru" })).toBe("ru");
  });
});
