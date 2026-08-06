import { describe, expect, it } from "vitest";

import { RTL_WIDGET_LOCALES, WIDGET_LOCALE_CODES } from "@site-chat/shared";

import { formatMessageTime, getWidgetDirection } from "./format";
import { dictionaryLoaders, englishMessages, loadWidgetDictionary } from "./load-dictionary";
import { WIDGET_MESSAGE_KEYS } from "./types";

describe("widget dictionaries", () => {
  it("has a loader for every canonical locale", () => {
    for (const code of WIDGET_LOCALE_CODES) {
      expect(dictionaryLoaders[code], `missing loader for ${code}`).toBeTypeOf("function");
    }
  });

  it("loads complete dictionaries with placeholder parity", async () => {
    for (const code of WIDGET_LOCALE_CODES) {
      const messages = await loadWidgetDictionary(code);
      for (const key of WIDGET_MESSAGE_KEYS) {
        expect(messages[key], `${code}.${key}`).toBeTypeOf("string");
        expect(messages[key].length, `${code}.${key} empty`).toBeGreaterThan(0);

        const enPlaceholders = englishMessages[key].match(/\{[^}]+\}/g) ?? [];
        const localePlaceholders = messages[key].match(/\{[^}]+\}/g) ?? [];
        expect(localePlaceholders.sort(), `${code}.${key} placeholders`).toEqual(
          enPlaceholders.sort(),
        );
      }
    }
  }, 60_000);

  it("marks RTL locales correctly", () => {
    expect(RTL_WIDGET_LOCALES).toEqual(["ar", "fa", "he"]);
    expect(getWidgetDirection("he")).toBe("rtl");
    expect(getWidgetDirection("ar")).toBe("rtl");
    expect(getWidgetDirection("fa")).toBe("rtl");
    expect(getWidgetDirection("en")).toBe("ltr");
  });
});

describe("formatMessageTime", () => {
  it("formats deterministically for a fixed instant", () => {
    const iso = "2026-08-06T15:30:00.000Z";
    const en = formatMessageTime(iso, "en");
    const ru = formatMessageTime(iso, "ru");
    expect(en.length).toBeGreaterThan(0);
    expect(ru.length).toBeGreaterThan(0);
  });

  it("degrades safely for invalid timestamps", () => {
    expect(formatMessageTime("not-a-date", "en")).toBe("");
    expect(formatMessageTime("", "he")).toBe("");
  });
});

describe("formatWidgetMessage", () => {
  it("interpolates {{name}} placeholders", async () => {
    const { formatWidgetMessage } = await import("./format");
    expect(
      formatWidgetMessage("{{name}} is typing…", { name: "Agent" }),
    ).toBe("Agent is typing…");
  });
});
