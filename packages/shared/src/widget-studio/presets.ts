import { defaultWidgetAppearanceConfig } from "./defaults";
import type { WidgetPresetId } from "./constants";
import type { WidgetAppearanceConfig } from "./schema";

type PresetPatch = Partial<
  Pick<
    WidgetAppearanceConfig,
    | "primaryColor"
    | "accentColor"
    | "backgroundColor"
    | "textColor"
    | "launcherColor"
    | "launcherShape"
    | "launcherSize"
    | "borderRadius"
    | "shadowLevel"
    | "density"
    | "headerStyle"
    | "fontFamily"
    | "fontSizeScale"
    | "colorMode"
    | "sendButtonStyle"
    | "widgetWidth"
    | "widgetHeight"
  >
>;

const PRESET_PATCHES: Record<WidgetPresetId, PresetPatch> = {
  clean: {
    primaryColor: "#2563EB",
    accentColor: "#1D4ED8",
    backgroundColor: "#FFFFFF",
    textColor: "#0F172A",
    launcherColor: "#2563EB",
    launcherShape: "circle",
    launcherSize: "md",
    borderRadius: 12,
    shadowLevel: "sm",
    density: "comfortable",
    headerStyle: "solid",
    fontFamily: "inter",
    fontSizeScale: "md",
    colorMode: "light",
    sendButtonStyle: "icon",
  },
  minimal: {
    primaryColor: "#111827",
    accentColor: "#374151",
    backgroundColor: "#FAFAFA",
    textColor: "#111827",
    launcherColor: "#111827",
    launcherShape: "rounded-square",
    launcherSize: "sm",
    borderRadius: 8,
    shadowLevel: "none",
    density: "compact",
    headerStyle: "minimal",
    fontFamily: "system",
    fontSizeScale: "sm",
    colorMode: "light",
    sendButtonStyle: "text",
  },
  modern: {
    primaryColor: "#0EA5E9",
    accentColor: "#0284C7",
    backgroundColor: "#FFFFFF",
    textColor: "#0C4A6E",
    launcherColor: "#0EA5E9",
    launcherShape: "circle",
    launcherSize: "lg",
    borderRadius: 20,
    shadowLevel: "lg",
    density: "comfortable",
    headerStyle: "branded",
    fontFamily: "geist",
    fontSizeScale: "md",
    colorMode: "light",
    sendButtonStyle: "icon-text",
    widgetWidth: 400,
    widgetHeight: 600,
  },
  dark: {
    primaryColor: "#38BDF8",
    accentColor: "#0EA5E9",
    backgroundColor: "#0F172A",
    textColor: "#E2E8F0",
    launcherColor: "#38BDF8",
    launcherShape: "circle",
    launcherSize: "md",
    borderRadius: 16,
    shadowLevel: "md",
    density: "comfortable",
    headerStyle: "solid",
    fontFamily: "ibm-plex-sans",
    fontSizeScale: "md",
    colorMode: "dark",
    sendButtonStyle: "icon",
  },
  rounded: {
    primaryColor: "#7C3AED",
    accentColor: "#6D28D9",
    backgroundColor: "#FFFFFF",
    textColor: "#1E1B4B",
    launcherColor: "#7C3AED",
    launcherShape: "circle",
    launcherSize: "md",
    borderRadius: 28,
    shadowLevel: "md",
    density: "comfortable",
    headerStyle: "branded",
    fontFamily: "nunito-sans",
    fontSizeScale: "md",
    colorMode: "light",
    sendButtonStyle: "icon",
  },
};

export type WidgetPresetDefinition = {
  id: WidgetPresetId;
  label: string;
  description: string;
};

export const WIDGET_PRESET_DEFINITIONS: readonly WidgetPresetDefinition[] = [
  {
    id: "clean",
    label: "Clean",
    description: "Neutral blue, soft shadow, comfortable density.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Compact chrome, flat shadow, understated controls.",
  },
  {
    id: "modern",
    label: "Modern",
    description: "Larger launcher, branded header, airy spacing.",
  },
  {
    id: "dark",
    label: "Dark",
    description: "Dark surfaces with bright accent for night-friendly sites.",
  },
  {
    id: "rounded",
    label: "Rounded",
    description: "Softer corners and friendly typography.",
  },
] as const;

/** Apply a preset onto defaults (or a base config). Presets populate typed fields only. */
export function applyWidgetPreset(
  presetId: WidgetPresetId,
  base: WidgetAppearanceConfig = defaultWidgetAppearanceConfig(),
): WidgetAppearanceConfig {
  const patch = PRESET_PATCHES[presetId];
  return {
    ...base,
    ...patch,
    presetId,
  };
}

export function listWidgetPresets(): readonly WidgetPresetDefinition[] {
  return WIDGET_PRESET_DEFINITIONS;
}
