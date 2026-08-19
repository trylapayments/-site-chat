import { z } from "zod";

import { WIDGET_LOCALE_CODES, type WidgetLocale } from "../i18n/widget-locales";
import { optionalWidgetLocaleInputSchema, widgetLocaleSchema } from "../schemas/widget";
import {
  WIDGET_ASSET_KINDS,
  WIDGET_COLOR_MODES,
  WIDGET_DENSITIES,
  WIDGET_DIMENSION_LIMITS,
  WIDGET_FONT_FAMILIES,
  WIDGET_FONT_SIZE_SCALES,
  WIDGET_HEADER_STYLES,
  WIDGET_HEX_COLOR_PATTERN,
  WIDGET_LAUNCHER_ICONS,
  WIDGET_LAUNCHER_SHAPES,
  WIDGET_LAUNCHER_SIZES,
  WIDGET_MOBILE_BEHAVIORS,
  WIDGET_POSITIONS,
  WIDGET_PRESET_IDS,
  WIDGET_SEND_BUTTON_STYLES,
  WIDGET_SHADOW_LEVELS,
} from "./constants";

export const widgetHexColorSchema = z
  .string()
  .regex(WIDGET_HEX_COLOR_PATTERN, "Color must be #RRGGBB");

/**
 * Customizable copy: system dictionaries by default; optional per-locale overrides.
 * An English override never silently replaces other locales.
 */
export const widgetLocalizedCopySchema = z
  .object({
    /** When true (default), missing locales use the widget i18n dictionary. */
    useSystemDefaults: z.boolean().default(true),
    /**
     * Per-locale overrides only. Keys must be canonical widget locales.
     * Locales absent here keep system copy when useSystemDefaults is true.
     */
    overrides: z.record(widgetLocaleSchema, z.string().trim().min(1).max(500)).default({}),
  })
  .strict();

export type WidgetLocalizedCopy = z.infer<typeof widgetLocalizedCopySchema>;

export const widgetBusinessHoursDaySchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday (JS Date.getDay). */
    day: z.number().int().min(0).max(6),
    /** Local time HH:mm (24h). */
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict()
  .refine((row) => row.start < row.end, {
    message: "Business hours start must be before end",
  });

export const widgetBusinessHoursSchema = z
  .object({
    enabled: z.boolean().default(false),
    timezone: z.string().min(1).max(64).default("UTC"),
    weekly: z.array(widgetBusinessHoursDaySchema).max(21).default([]),
    onlineGreeting: widgetLocalizedCopySchema.optional(),
    offlineGreeting: widgetLocalizedCopySchema.optional(),
    awayMessage: widgetLocalizedCopySchema.optional(),
  })
  .strict();

export type WidgetBusinessHours = z.infer<typeof widgetBusinessHoursSchema>;

const assetIdSchema = z.string().uuid().nullable();

/**
 * Full durable appearance + behavior config (draft and published share this shape).
 * No arbitrary CSS — typed fields only.
 */
const widgetAppearanceConfigObjectSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),

    // --- Colors ---
    primaryColor: widgetHexColorSchema,
    accentColor: widgetHexColorSchema,
    backgroundColor: widgetHexColorSchema,
    textColor: widgetHexColorSchema,
    launcherColor: widgetHexColorSchema,

    // --- Launcher ---
    launcherIcon: z.enum(WIDGET_LAUNCHER_ICONS),
    launcherShape: z.enum(WIDGET_LAUNCHER_SHAPES),
    launcherSize: z.enum(WIDGET_LAUNCHER_SIZES),
    launcherPosition: z.enum(WIDGET_POSITIONS),
    launcherOffsetX: z
      .number()
      .int()
      .min(WIDGET_DIMENSION_LIMITS.offsetMin)
      .max(WIDGET_DIMENSION_LIMITS.offsetMax),
    launcherOffsetY: z
      .number()
      .int()
      .min(WIDGET_DIMENSION_LIMITS.offsetMin)
      .max(WIDGET_DIMENSION_LIMITS.offsetMax),
    launcherIconAssetId: assetIdSchema,

    // --- Chat window ---
    borderRadius: z
      .number()
      .int()
      .min(WIDGET_DIMENSION_LIMITS.borderRadiusMin)
      .max(WIDGET_DIMENSION_LIMITS.borderRadiusMax),
    shadowLevel: z.enum(WIDGET_SHADOW_LEVELS),
    widgetWidth: z
      .number()
      .int()
      .min(WIDGET_DIMENSION_LIMITS.widthMin)
      .max(WIDGET_DIMENSION_LIMITS.widthMax),
    widgetHeight: z
      .number()
      .int()
      .min(WIDGET_DIMENSION_LIMITS.heightMin)
      .max(WIDGET_DIMENSION_LIMITS.heightMax),
    widgetMaxHeight: z
      .number()
      .int()
      .min(WIDGET_DIMENSION_LIMITS.maxHeightMin)
      .max(WIDGET_DIMENSION_LIMITS.maxHeightMax),
    density: z.enum(WIDGET_DENSITIES),

    // --- Header / branding ---
    headerStyle: z.enum(WIDGET_HEADER_STYLES),
    headerTitle: widgetLocalizedCopySchema,
    subtitle: widgetLocalizedCopySchema,
    logoAssetId: assetIdSchema,
    agentAvatarAssetId: assetIdSchema,

    // --- Messages / copy ---
    welcomeMessage: widgetLocalizedCopySchema,
    placeholderText: widgetLocalizedCopySchema,
    sendButtonStyle: z.enum(WIDGET_SEND_BUTTON_STYLES),

    // --- Typography ---
    fontFamily: z.enum(WIDGET_FONT_FAMILIES),
    fontSizeScale: z.enum(WIDGET_FONT_SIZE_SCALES),
    colorMode: z.enum(WIDGET_COLOR_MODES),

    // --- Behavior ---
    autoOpenDelayMs: z
      .number()
      .int()
      .min(0)
      .max(WIDGET_DIMENSION_LIMITS.autoOpenDelayMaxMs)
      .nullable(),
    hideLauncherWhenOpen: z.boolean(),
    showGreeting: z.boolean(),
    mobileBehavior: z.enum(WIDGET_MOBILE_BEHAVIORS),
    showAgentAvatars: z.boolean(),
    showPoweredBy: z.boolean(),
    soundEnabled: z.boolean(),

    // --- Locale / session ---
    locale: optionalWidgetLocaleInputSchema,
    reopenWindowHours: z.number().int().min(1).max(720),

    // --- Business hours foundation (not full routing/SLA) ---
    businessHours: widgetBusinessHoursSchema,

    // --- Optional preset stamp (informational; fields remain authoritative) ---
    presetId: z.enum(WIDGET_PRESET_IDS).nullable().default(null),
  })
  .strict();

export const widgetAppearanceConfigSchema = widgetAppearanceConfigObjectSchema.superRefine(
  (config, ctx) => {
    if (config.widgetMaxHeight < config.widgetHeight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "widgetMaxHeight must be >= widgetHeight",
        path: ["widgetMaxHeight"],
      });
    }
  },
);

export type WidgetAppearanceConfig = z.infer<typeof widgetAppearanceConfigSchema>;

/** Partial patch for Studio saves (deep-merge applied server-side against draft). */
export const widgetAppearanceConfigPatchSchema = widgetAppearanceConfigObjectSchema
  .partial()
  .strict();

export type WidgetAppearanceConfigPatch = z.infer<typeof widgetAppearanceConfigPatchSchema>;

export const widgetAssetKindSchema = z.enum(WIDGET_ASSET_KINDS);

export const widgetStudioStateSchema = z
  .object({
    draft: widgetAppearanceConfigSchema,
    published: widgetAppearanceConfigSchema,
    publishedVersion: z.number().int().positive(),
    draftUpdatedAt: z.string(),
    publishedAt: z.string(),
    draftDirty: z.boolean(),
  })
  .strict();

export type WidgetStudioState = z.infer<typeof widgetStudioStateSchema>;

export const widgetPresetIdSchema = z.enum(WIDGET_PRESET_IDS);

export type { WidgetLocale };
export { WIDGET_LOCALE_CODES };
