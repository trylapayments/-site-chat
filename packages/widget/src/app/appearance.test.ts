import { describe, expect, it } from "vitest";

import {
  clampedPixels,
  contrastingTextColor,
  fontFamilyStack,
  launcherRadius,
  mixHexColors,
  positionInsets,
  resolveLocalizedCopy,
} from "./appearance";

describe("widget appearance helpers", () => {
  it("never applies an English override to a Hebrew visitor", () => {
    const copy = {
      useSystemDefaults: true,
      overrides: { en: "English custom welcome" },
    };

    expect(
      resolveLocalizedCopy({
        copy,
        locale: "he",
        systemFallback: "ברוכים הבאים",
      }),
    ).toBe("ברוכים הבאים");
    expect(
      resolveLocalizedCopy({
        copy,
        locale: "en",
        systemFallback: "Welcome",
      }),
    ).toBe("English custom welcome");
  });

  it("maps only allowlisted fonts and launcher shapes", () => {
    expect(fontFamilyStack("ibm-plex-sans")).toContain('"IBM Plex Sans"');
    expect(fontFamilyStack(undefined)).toContain("system-ui");
    expect(launcherRadius("circle")).toBe("50%");
    expect(launcherRadius("square")).toBe("0.375rem");
  });

  it("keeps launcher insets physical in RTL layouts", () => {
    expect(positionInsets("bottom-left", 24)).toEqual({
      left: "24px",
      right: "auto",
    });
    expect(positionInsets("bottom-right", 24)).toEqual({
      right: "24px",
      left: "auto",
    });
  });

  it("clamps numeric values and derives safe colors", () => {
    expect(clampedPixels(1_000, 16, 0, 120)).toBe(120);
    expect(clampedPixels(Number.NaN, 16, 0, 120)).toBe(16);
    expect(mixHexColors("#FFFFFF", "#000000", 0.1)).toBe("#E6E6E6");
    expect(contrastingTextColor("#FFFFFF")).toBe("#000000");
    expect(contrastingTextColor("#000000")).toBe("#FFFFFF");
  });
});
