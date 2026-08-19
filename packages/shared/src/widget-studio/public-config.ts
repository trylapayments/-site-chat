import { z } from "zod";

import { widgetLocaleInputSchema } from "../schemas/widget";
import {
  WIDGET_COLOR_MODES,
  WIDGET_DENSITIES,
  WIDGET_FONT_FAMILIES,
  WIDGET_FONT_SIZE_SCALES,
  WIDGET_HEADER_STYLES,
  WIDGET_LAUNCHER_ICONS,
  WIDGET_LAUNCHER_SHAPES,
  WIDGET_LAUNCHER_SIZES,
  WIDGET_MOBILE_BEHAVIORS,
  WIDGET_POSITIONS,
  WIDGET_SEND_BUTTON_STYLES,
  WIDGET_SHADOW_LEVELS,
} from "./constants";
import { defaultWidgetStudioEntitlements, resolveShowPoweredBy } from "./entitlements";
import type { WidgetStudioEntitlements } from "./entitlements";
import { widgetAppearanceConfigSchema, widgetHexColorSchema } from "./schema";
import type { WidgetAppearanceConfig, WidgetLocalizedCopy } from "./schema";

/**
 * Public localized copy DTO — only overrides map (no internal flags beyond useSystemDefaults).
 * Never includes operator notes or unpublished draft strings.
 */
export const widgetPublicLocalizedCopySchema = z
  .object({
    useSystemDefaults: z.boolean(),
    overrides: z.record(z.string(), z.string().max(500)),
  })
  .strict();

export const widgetPublicBusinessHoursSchema = z
  .object({
    enabled: z.boolean(),
    timezone: z.string().max(64),
    weekly: z.array(
      z
        .object({
          day: z.number().int().min(0).max(6),
          start: z.string(),
          end: z.string(),
        })
        .strict(),
    ),
    onlineGreeting: widgetPublicLocalizedCopySchema.nullable(),
    offlineGreeting: widgetPublicLocalizedCopySchema.nullable(),
    awayMessage: widgetPublicLocalizedCopySchema.nullable(),
  })
  .strict();

/**
 * Explicit public widget config DTO.
 * CRITICAL: must never include billing, operator emails, CRM, secrets, or draft config.
 */
export const widgetPublicAppearanceSchema = z
  .object({
    version: z.number().int().positive(),
    updatedAt: z.string(),
    locale: widgetLocaleInputSchema,
    reopenWindowHours: z.number().int().min(1).max(720),

    primaryColor: widgetHexColorSchema,
    accentColor: widgetHexColorSchema,
    backgroundColor: widgetHexColorSchema,
    textColor: widgetHexColorSchema,
    launcherColor: widgetHexColorSchema,

    launcherIcon: z.enum(WIDGET_LAUNCHER_ICONS),
    launcherShape: z.enum(WIDGET_LAUNCHER_SHAPES),
    launcherSize: z.enum(WIDGET_LAUNCHER_SIZES),
    position: z.enum(WIDGET_POSITIONS),
    launcherOffsetX: z.number().int(),
    launcherOffsetY: z.number().int(),
    launcherIconUrl: z.string().url().nullable(),

    borderRadius: z.number().int(),
    shadowLevel: z.enum(WIDGET_SHADOW_LEVELS),
    widgetWidth: z.number().int(),
    widgetHeight: z.number().int(),
    widgetMaxHeight: z.number().int(),
    density: z.enum(WIDGET_DENSITIES),

    headerStyle: z.enum(WIDGET_HEADER_STYLES),
    headerTitle: widgetPublicLocalizedCopySchema,
    subtitle: widgetPublicLocalizedCopySchema,
    logoUrl: z.string().url().nullable(),
    agentAvatarUrl: z.string().url().nullable(),

    welcomeMessage: widgetPublicLocalizedCopySchema,
    placeholderText: widgetPublicLocalizedCopySchema,
    sendButtonStyle: z.enum(WIDGET_SEND_BUTTON_STYLES),

    fontFamily: z.enum(WIDGET_FONT_FAMILIES),
    fontSizeScale: z.enum(WIDGET_FONT_SIZE_SCALES),
    colorMode: z.enum(WIDGET_COLOR_MODES),

    autoOpenDelayMs: z.number().int().nullable(),
    hideLauncherWhenOpen: z.boolean(),
    showGreeting: z.boolean(),
    mobileBehavior: z.enum(WIDGET_MOBILE_BEHAVIORS),
    showAgentAvatars: z.boolean(),
    showPoweredBy: z.boolean(),
    soundEnabled: z.boolean(),

    businessHours: widgetPublicBusinessHoursSchema,

    /** Compatibility aliases for older widget clients. */
    greetingMessage: z.string().min(1).max(500),
    branding: z
      .object({
        displayName: z.string().nullable(),
        logoUrl: z.union([z.string().url(), z.null()]),
        primaryColor: widgetHexColorSchema,
        showPoweredBy: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type WidgetPublicAppearance = z.infer<typeof widgetPublicAppearanceSchema>;

function toPublicCopy(copy: WidgetLocalizedCopy): {
  useSystemDefaults: boolean;
  overrides: Record<string, string>;
} {
  const overrides: Record<string, string> = {};
  for (const [locale, value] of Object.entries(copy.overrides ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) {
      overrides[locale] = value;
    }
  }
  return {
    useSystemDefaults: copy.useSystemDefaults !== false,
    overrides,
  };
}

function firstOverrideOr(
  copy: WidgetLocalizedCopy,
  fallback: string,
  preferredLocale = "en",
): string {
  const preferred = copy.overrides?.[preferredLocale as keyof typeof copy.overrides];
  if (typeof preferred === "string" && preferred.trim().length > 0) {
    return preferred;
  }
  const values = Object.values(copy.overrides ?? {});
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return fallback;
}

export type MapPublicAppearanceInput = {
  config: WidgetAppearanceConfig;
  publishedVersion: number;
  publishedAt: string;
  assets?: {
    logoUrl?: string | null;
    launcherIconUrl?: string | null;
    agentAvatarUrl?: string | null;
  };
  entitlements?: WidgetStudioEntitlements;
};

/**
 * Map published appearance → public DTO. Call only with published config.
 */
export function mapAppearanceToPublicConfig(
  input: MapPublicAppearanceInput,
): WidgetPublicAppearance {
  const config = widgetAppearanceConfigSchema.parse(input.config);
  const entitlements = input.entitlements ?? defaultWidgetStudioEntitlements();
  const showPoweredBy = resolveShowPoweredBy({
    configured: config.showPoweredBy,
    entitlements,
  });

  const welcome = toPublicCopy(config.welcomeMessage);
  const headerTitle = toPublicCopy(config.headerTitle);
  const greetingMessage = firstOverrideOr(
    config.welcomeMessage,
    "Hi! How can we help?",
  );
  const displayName = firstOverrideOr(config.headerTitle, "") || null;

  const logoUrl = input.assets?.logoUrl ?? null;
  const launcherIconUrl = input.assets?.launcherIconUrl ?? null;
  const agentAvatarUrl = input.assets?.agentAvatarUrl ?? null;

  const bh = config.businessHours;

  return widgetPublicAppearanceSchema.parse({
    version: input.publishedVersion,
    updatedAt: input.publishedAt,
    locale: config.locale ?? "en",
    reopenWindowHours: config.reopenWindowHours,

    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    backgroundColor: config.backgroundColor,
    textColor: config.textColor,
    launcherColor: config.launcherColor,

    launcherIcon: config.launcherIcon,
    launcherShape: config.launcherShape,
    launcherSize: config.launcherSize,
    position: config.launcherPosition,
    launcherOffsetX: config.launcherOffsetX,
    launcherOffsetY: config.launcherOffsetY,
    launcherIconUrl,

    borderRadius: config.borderRadius,
    shadowLevel: config.shadowLevel,
    widgetWidth: config.widgetWidth,
    widgetHeight: config.widgetHeight,
    widgetMaxHeight: config.widgetMaxHeight,
    density: config.density,

    headerStyle: config.headerStyle,
    headerTitle,
    subtitle: toPublicCopy(config.subtitle),
    logoUrl,
    agentAvatarUrl,

    welcomeMessage: welcome,
    placeholderText: toPublicCopy(config.placeholderText),
    sendButtonStyle: config.sendButtonStyle,

    fontFamily: config.fontFamily,
    fontSizeScale: config.fontSizeScale,
    colorMode: config.colorMode,

    autoOpenDelayMs: config.autoOpenDelayMs,
    hideLauncherWhenOpen: config.hideLauncherWhenOpen,
    showGreeting: config.showGreeting,
    mobileBehavior: config.mobileBehavior,
    showAgentAvatars: config.showAgentAvatars,
    showPoweredBy,
    soundEnabled: config.soundEnabled,

    businessHours: {
      enabled: bh.enabled,
      timezone: bh.timezone,
      weekly: bh.weekly,
      onlineGreeting: bh.onlineGreeting ? toPublicCopy(bh.onlineGreeting) : null,
      offlineGreeting: bh.offlineGreeting ? toPublicCopy(bh.offlineGreeting) : null,
      awayMessage: bh.awayMessage ? toPublicCopy(bh.awayMessage) : null,
    },

    greetingMessage,
    branding: {
      displayName,
      logoUrl,
      primaryColor: config.primaryColor,
      showPoweredBy,
    },
  });
}

/**
 * Strip unknown keys from a candidate public payload (defense in depth).
 * Used when reading JSON from SQL before Zod parse.
 */
export const PUBLIC_APPEARANCE_FORBIDDEN_KEYS = [
  "draft",
  "draft_json",
  "settings_json",
  "billing",
  "stripe",
  "operatorEmail",
  "operator_emails",
  "crm",
  "secret",
  "secrets",
  "serviceRole",
  "storageCredentials",
  "members",
  "ai",
  "privacy",
] as const;
