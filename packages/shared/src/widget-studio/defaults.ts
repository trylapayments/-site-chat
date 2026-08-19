import type { WidgetAppearanceConfig, WidgetLocalizedCopy } from "./schema";

export function emptyLocalizedCopy(): WidgetLocalizedCopy {
  return {
    useSystemDefaults: true,
    overrides: {},
  };
}

/**
 * Canonical defaults for a new workspace widget.
 * Production bootstrap maps these into the public DTO when no published row exists yet.
 */
export function defaultWidgetAppearanceConfig(): WidgetAppearanceConfig {
  return {
    schemaVersion: 1,
    primaryColor: "#0066FF",
    accentColor: "#0052CC",
    backgroundColor: "#FFFFFF",
    textColor: "#111827",
    launcherColor: "#0066FF",
    launcherIcon: "chat",
    launcherShape: "circle",
    launcherSize: "md",
    launcherPosition: "bottom-right",
    launcherOffsetX: 16,
    launcherOffsetY: 16,
    launcherIconAssetId: null,
    borderRadius: 16,
    shadowLevel: "md",
    widgetWidth: 380,
    widgetHeight: 560,
    widgetMaxHeight: 720,
    density: "comfortable",
    headerStyle: "solid",
    headerTitle: emptyLocalizedCopy(),
    subtitle: emptyLocalizedCopy(),
    logoAssetId: null,
    agentAvatarAssetId: null,
    welcomeMessage: {
      useSystemDefaults: true,
      overrides: {
        en: "Hi! How can we help?",
      },
    },
    placeholderText: emptyLocalizedCopy(),
    sendButtonStyle: "icon",
    fontFamily: "system",
    fontSizeScale: "md",
    colorMode: "light",
    autoOpenDelayMs: null,
    hideLauncherWhenOpen: true,
    showGreeting: true,
    mobileBehavior: "fullscreen",
    showAgentAvatars: true,
    showPoweredBy: true,
    soundEnabled: false,
    locale: "en",
    reopenWindowHours: 24,
    businessHours: {
      enabled: false,
      timezone: "UTC",
      weekly: [],
    },
    presetId: null,
  };
}

/**
 * Migrate legacy `settings_json.widget` (pre–Widget Studio) into appearance config.
 */
export function appearanceFromLegacyWidgetSettings(legacy: unknown): WidgetAppearanceConfig {
  const base = defaultWidgetAppearanceConfig();
  if (!legacy || typeof legacy !== "object") {
    return base;
  }

  const widget = legacy as Record<string, unknown>;
  const branding =
    widget.branding && typeof widget.branding === "object"
      ? (widget.branding as Record<string, unknown>)
      : {};

  if (typeof widget.locale === "string") {
    base.locale = widget.locale as WidgetAppearanceConfig["locale"];
  }

  if (typeof widget.greetingMessage === "string" && widget.greetingMessage.length > 0) {
    base.welcomeMessage = {
      useSystemDefaults: true,
      overrides: { en: widget.greetingMessage.slice(0, 500) },
    };
  }

  if (typeof widget.reopenWindowHours === "number") {
    base.reopenWindowHours = widget.reopenWindowHours;
  }

  if (widget.position === "bottom-left" || widget.position === "bottom-right") {
    base.launcherPosition = widget.position;
  }

  if (typeof branding.displayName === "string" && branding.displayName.length > 0) {
    base.headerTitle = {
      useSystemDefaults: true,
      overrides: { en: branding.displayName.slice(0, 100) },
    };
  }

  if (
    typeof branding.primaryColor === "string" &&
    /^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor)
  ) {
    base.primaryColor = branding.primaryColor;
    base.launcherColor = branding.primaryColor;
    base.accentColor = branding.primaryColor;
  }

  if (typeof branding.showPoweredBy === "boolean") {
    base.showPoweredBy = branding.showPoweredBy;
  }

  return base;
}
