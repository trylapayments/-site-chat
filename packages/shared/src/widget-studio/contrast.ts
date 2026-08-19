/**
 * WCAG-oriented contrast helpers for Widget Studio warnings.
 * Warnings only — we never silently force colors.
 */

export type ContrastCheckResult = {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  warning: string | null;
};

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!match?.[1]) {
    return null;
  }
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) {
    return null;
  }
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  if (l1 === null || l2 === null) {
    return null;
  }
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkContrast(
  foreground: string,
  background: string,
  label = "Text",
): ContrastCheckResult {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) {
    return {
      ratio: 0,
      aaNormal: false,
      aaLarge: false,
      warning: `${label}: invalid color values.`,
    };
  }
  const aaNormal = ratio >= 4.5;
  const aaLarge = ratio >= 3;
  let warning: string | null = null;
  if (!aaNormal) {
    warning = `${label}: contrast ${ratio.toFixed(2)}:1 is below WCAG AA (4.5:1).`;
  }
  return { ratio, aaNormal, aaLarge, warning };
}

export type WidgetAppearanceContrastWarnings = {
  textOnBackground: ContrastCheckResult;
  primaryOnBackground: ContrastCheckResult;
  launcherOnAssumedPage: ContrastCheckResult;
  warnings: string[];
};

/**
 * Studio surface warnings for common unusable combinations.
 * Assumes a light page (#F8FAFC) when checking launcher visibility.
 */
export function collectAppearanceContrastWarnings(input: {
  textColor: string;
  backgroundColor: string;
  primaryColor: string;
  launcherColor: string;
}): WidgetAppearanceContrastWarnings {
  const textOnBackground = checkContrast(input.textColor, input.backgroundColor, "Body text");
  const primaryOnBackground = checkContrast(
    input.primaryColor,
    input.backgroundColor,
    "Primary on background",
  );
  const launcherOnAssumedPage = checkContrast(
    input.launcherColor,
    "#F8FAFC",
    "Launcher on typical page",
  );

  const warnings = [
    textOnBackground.warning,
    primaryOnBackground.warning,
    launcherOnAssumedPage.warning,
  ].filter((value): value is string => value !== null);

  return {
    textOnBackground,
    primaryOnBackground,
    launcherOnAssumedPage,
    warnings,
  };
}
