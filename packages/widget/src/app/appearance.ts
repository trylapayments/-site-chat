import type { WidgetLocalizedCopy, WidgetPublicConfig } from "../api/client";

const FONT_STACKS: Record<WidgetPublicConfig["fontFamily"], string> = {
  system:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  geist: 'Geist, Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  "source-sans": '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif',
  "ibm-plex-sans": '"IBM Plex Sans", system-ui, sans-serif',
  "nunito-sans": '"Nunito Sans", system-ui, sans-serif',
};

const SHADOWS: Record<WidgetPublicConfig["shadowLevel"], string> = {
  none: "none",
  sm: "0 4px 12px rgba(0, 0, 0, 0.12)",
  md: "0 20px 40px rgba(0, 0, 0, 0.18)",
  lg: "0 28px 64px rgba(0, 0, 0, 0.24)",
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function resolveLocalizedCopy(input: {
  copy: WidgetLocalizedCopy | undefined | null;
  locale: string;
  systemFallback: string;
}): string {
  const override = input.copy?.overrides[input.locale];
  if (typeof override === "string" && override.trim().length > 0) {
    return override;
  }

  // Missing locale overrides always stay localized through the system dictionary.
  return input.systemFallback;
}

export function safeHexColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value : fallback;
}

export function mixHexColors(background: string, foreground: string, weight: number): string {
  const safeBackground = safeHexColor(background, "#FFFFFF");
  const safeForeground = safeHexColor(foreground, "#000000");
  const amount = Math.min(1, Math.max(0, weight));
  const channel = (offset: number) => {
    const from = Number.parseInt(safeBackground.slice(offset, offset + 2), 16);
    const to = Number.parseInt(safeForeground.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}

export function contrastingTextColor(background: string): "#000000" | "#FFFFFF" {
  const color = safeHexColor(background, "#0066FF");
  const linearChannel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? "#FFFFFF" : "#000000";
}

export function fontFamilyStack(family: WidgetPublicConfig["fontFamily"] | undefined): string {
  return FONT_STACKS[family ?? "system"];
}

export function fontSizeForScale(scale: WidgetPublicConfig["fontSizeScale"] | undefined): string {
  return scale === "sm" ? "14px" : scale === "lg" ? "18px" : "16px";
}

export function launcherSizePixels(size: WidgetPublicConfig["launcherSize"] | undefined): number {
  return size === "sm" ? 48 : size === "lg" ? 64 : 56;
}

export function launcherRadius(shape: WidgetPublicConfig["launcherShape"] | undefined): string {
  return shape === "square" ? "0.375rem" : shape === "rounded-square" ? "28%" : "50%";
}

export function widgetShadow(level: WidgetPublicConfig["shadowLevel"] | undefined): string {
  return SHADOWS[level ?? "md"];
}

export function clampedPixels(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value as number)))
    : fallback;
}

export function positionInsets(
  position: WidgetPublicConfig["position"] | undefined,
  offsetX: number,
): { left: string; right: string } {
  // Physical left/right: writing direction must never mirror widget placement.
  if (position === "bottom-left") {
    return { left: `${String(offsetX)}px`, right: "auto" };
  }
  return { right: `${String(offsetX)}px`, left: "auto" };
}
