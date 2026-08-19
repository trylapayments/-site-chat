import { defaultWidgetAppearanceConfig } from "./defaults";
import { widgetAppearanceConfigSchema } from "./schema";
import type { WidgetAppearanceConfig, WidgetAppearanceConfigPatch } from "./schema";

/**
 * Deep-merge a Studio patch onto a base appearance config, then re-validate.
 */
export function mergeAppearanceConfig(
  base: WidgetAppearanceConfig,
  patch: WidgetAppearanceConfigPatch,
): WidgetAppearanceConfig {
  const merged: WidgetAppearanceConfig = {
    ...base,
    ...patch,
    headerTitle: patch.headerTitle
      ? {
          useSystemDefaults:
            patch.headerTitle.useSystemDefaults ?? base.headerTitle.useSystemDefaults,
          overrides: {
            ...base.headerTitle.overrides,
            ...patch.headerTitle.overrides,
          },
        }
      : base.headerTitle,
    subtitle: patch.subtitle
      ? {
          useSystemDefaults:
            patch.subtitle.useSystemDefaults ?? base.subtitle.useSystemDefaults,
          overrides: {
            ...base.subtitle.overrides,
            ...patch.subtitle.overrides,
          },
        }
      : base.subtitle,
    welcomeMessage: patch.welcomeMessage
      ? {
          useSystemDefaults:
            patch.welcomeMessage.useSystemDefaults ??
            base.welcomeMessage.useSystemDefaults,
          overrides: {
            ...base.welcomeMessage.overrides,
            ...patch.welcomeMessage.overrides,
          },
        }
      : base.welcomeMessage,
    placeholderText: patch.placeholderText
      ? {
          useSystemDefaults:
            patch.placeholderText.useSystemDefaults ??
            base.placeholderText.useSystemDefaults,
          overrides: {
            ...base.placeholderText.overrides,
            ...patch.placeholderText.overrides,
          },
        }
      : base.placeholderText,
    businessHours: patch.businessHours
      ? {
          ...base.businessHours,
          ...patch.businessHours,
          weekly: patch.businessHours.weekly ?? base.businessHours.weekly,
          onlineGreeting:
            patch.businessHours.onlineGreeting ?? base.businessHours.onlineGreeting,
          offlineGreeting:
            patch.businessHours.offlineGreeting ?? base.businessHours.offlineGreeting,
          awayMessage: patch.businessHours.awayMessage ?? base.businessHours.awayMessage,
        }
      : base.businessHours,
  };

  return widgetAppearanceConfigSchema.parse(merged);
}

export function resetAppearanceToDefaults(): WidgetAppearanceConfig {
  return defaultWidgetAppearanceConfig();
}

/** Stable JSON for dirty comparison (key-sorted). */
export function appearanceConfigFingerprint(config: WidgetAppearanceConfig): string {
  return JSON.stringify(sortKeys(config));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}

export function isAppearanceDraftDirty(
  draft: WidgetAppearanceConfig,
  published: WidgetAppearanceConfig,
): boolean {
  return appearanceConfigFingerprint(draft) !== appearanceConfigFingerprint(published);
}
