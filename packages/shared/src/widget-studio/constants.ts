/**
 * Widget Studio constants — typed allowlists only (no arbitrary CSS/fonts).
 */

export const WIDGET_FONT_FAMILIES = [
  "system",
  "inter",
  "geist",
  "source-sans",
  "ibm-plex-sans",
  "nunito-sans",
] as const;

export type WidgetFontFamily = (typeof WIDGET_FONT_FAMILIES)[number];

/** CSS font-family stacks for allowlisted fonts (embedded widget only). */
export const WIDGET_FONT_FAMILY_STACKS: Record<WidgetFontFamily, string> = {
  system:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  geist: 'Geist, Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  "source-sans": '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif',
  "ibm-plex-sans": '"IBM Plex Sans", system-ui, sans-serif',
  "nunito-sans": '"Nunito Sans", system-ui, sans-serif',
};

export const WIDGET_LAUNCHER_ICONS = ["chat", "message", "help", "custom"] as const;
export type WidgetLauncherIcon = (typeof WIDGET_LAUNCHER_ICONS)[number];

export const WIDGET_LAUNCHER_SHAPES = ["circle", "rounded-square", "square"] as const;
export type WidgetLauncherShape = (typeof WIDGET_LAUNCHER_SHAPES)[number];

export const WIDGET_LAUNCHER_SIZES = ["sm", "md", "lg"] as const;
export type WidgetLauncherSize = (typeof WIDGET_LAUNCHER_SIZES)[number];

export const WIDGET_POSITIONS = ["bottom-right", "bottom-left"] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];

export const WIDGET_SHADOW_LEVELS = ["none", "sm", "md", "lg"] as const;
export type WidgetShadowLevel = (typeof WIDGET_SHADOW_LEVELS)[number];

export const WIDGET_DENSITIES = ["compact", "comfortable"] as const;
export type WidgetDensity = (typeof WIDGET_DENSITIES)[number];

export const WIDGET_HEADER_STYLES = ["solid", "minimal", "branded"] as const;
export type WidgetHeaderStyle = (typeof WIDGET_HEADER_STYLES)[number];

export const WIDGET_SEND_BUTTON_STYLES = ["icon", "text", "icon-text"] as const;
export type WidgetSendButtonStyle = (typeof WIDGET_SEND_BUTTON_STYLES)[number];

export const WIDGET_FONT_SIZE_SCALES = ["sm", "md", "lg"] as const;
export type WidgetFontSizeScale = (typeof WIDGET_FONT_SIZE_SCALES)[number];

export const WIDGET_COLOR_MODES = ["light", "dark", "system"] as const;
export type WidgetColorMode = (typeof WIDGET_COLOR_MODES)[number];

export const WIDGET_MOBILE_BEHAVIORS = ["responsive", "fullscreen"] as const;
export type WidgetMobileBehavior = (typeof WIDGET_MOBILE_BEHAVIORS)[number];

export const WIDGET_ASSET_KINDS = ["logo", "launcher_icon", "agent_avatar"] as const;
export type WidgetAssetKind = (typeof WIDGET_ASSET_KINDS)[number];

export const WIDGET_PRESET_IDS = [
  "clean",
  "minimal",
  "modern",
  "dark",
  "rounded",
] as const;
export type WidgetPresetId = (typeof WIDGET_PRESET_IDS)[number];

/** Hex color (#RRGGBB). */
export const WIDGET_HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const WIDGET_ASSET_LIMITS = {
  maxBytes: 512 * 1024,
  maxWidth: 1024,
  maxHeight: 1024,
  minWidth: 16,
  minHeight: 16,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const,
  signedUploadTtlSeconds: 10 * 60,
  /** Public config download URLs — long enough for a page session; refreshed on bootstrap. */
  signedDownloadTtlSeconds: 60 * 60,
  maxFilenameLength: 128,
} as const;

export const WIDGET_DIMENSION_LIMITS = {
  offsetMin: 0,
  offsetMax: 120,
  borderRadiusMin: 0,
  borderRadiusMax: 32,
  widthMin: 300,
  widthMax: 480,
  heightMin: 360,
  heightMax: 800,
  maxHeightMin: 360,
  maxHeightMax: 900,
  autoOpenDelayMaxMs: 60_000,
} as const;

/** Storage bucket for workspace widget brand assets (private; signed access). */
export const WIDGET_ASSETS_BUCKET = "widget-assets";
