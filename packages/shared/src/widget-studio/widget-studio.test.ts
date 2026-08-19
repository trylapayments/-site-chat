import { describe, expect, it } from "vitest";

import { isWithinBusinessHours } from "./business-hours";
import { checkContrast, collectAppearanceContrastWarnings } from "./contrast";
import { appearanceFromLegacyWidgetSettings, defaultWidgetAppearanceConfig } from "./defaults";
import {
  defaultWidgetStudioEntitlements,
  hasWidgetStudioFeature,
  resolveShowPoweredBy,
  resolveWidgetStudioEntitlements,
} from "./entitlements";
import { resolveLocalizedCopy } from "./locale-copy";
import { isAppearanceDraftDirty, mergeAppearanceConfig } from "./merge";
import { applyWidgetPreset, listWidgetPresets } from "./presets";
import { resolveLauncherPlacement } from "./positioning";
import {
  mapAppearanceToPublicConfig,
  PUBLIC_APPEARANCE_FORBIDDEN_KEYS,
  widgetPublicAppearanceSchema,
} from "./public-config";
import { widgetAppearanceConfigSchema } from "./schema";

describe("widget appearance schema", () => {
  it("parses defaults", () => {
    const config = defaultWidgetAppearanceConfig();
    expect(widgetAppearanceConfigSchema.parse(config).primaryColor).toBe("#0066FF");
  });

  it("rejects arbitrary CSS-like fields", () => {
    const result = widgetAppearanceConfigSchema.safeParse({
      ...defaultWidgetAppearanceConfig(),
      customCss: "body { display:none }",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hex colors", () => {
    const result = widgetAppearanceConfigSchema.safeParse({
      ...defaultWidgetAppearanceConfig(),
      primaryColor: "blue",
    });
    expect(result.success).toBe(false);
  });

  it("migrates legacy settings_json.widget", () => {
    const migrated = appearanceFromLegacyWidgetSettings({
      locale: "he",
      greetingMessage: "שלום",
      position: "bottom-left",
      branding: {
        displayName: "Acme",
        primaryColor: "#112233",
        showPoweredBy: false,
      },
    });
    expect(migrated.locale).toBe("he");
    expect(migrated.launcherPosition).toBe("bottom-left");
    expect(migrated.primaryColor).toBe("#112233");
    expect(migrated.welcomeMessage.overrides.he).toBeUndefined();
    expect(migrated.welcomeMessage.overrides.en).toBe("שלום");
    expect(migrated.showPoweredBy).toBe(false);
  });
});

describe("presets", () => {
  it("lists five high-quality presets", () => {
    expect(listWidgetPresets()).toHaveLength(5);
  });

  it("applies typed fields without CSS", () => {
    const dark = applyWidgetPreset("dark");
    expect(dark.colorMode).toBe("dark");
    expect(dark.backgroundColor).toBe("#0F172A");
    expect(dark.presetId).toBe("dark");
    expect(widgetAppearanceConfigSchema.parse(dark).schemaVersion).toBe(1);
  });
});

describe("contrast", () => {
  it("flags low-contrast text", () => {
    const result = checkContrast("#EEEEEE", "#FFFFFF", "Body");
    expect(result.aaNormal).toBe(false);
    expect(result.warning).toContain("contrast");
  });

  it("accepts readable pairs", () => {
    const result = checkContrast("#111827", "#FFFFFF");
    expect(result.aaNormal).toBe(true);
    expect(result.warning).toBeNull();
  });

  it("collects studio warnings", () => {
    const warnings = collectAppearanceContrastWarnings({
      textColor: "#FFFFFF",
      backgroundColor: "#FFFFFF",
      primaryColor: "#FFFFFF",
      launcherColor: "#FFFFFF",
    });
    expect(warnings.warnings.length).toBeGreaterThan(0);
  });
});

describe("public DTO mapping", () => {
  it("maps published config and keeps branding compatibility", () => {
    const config = applyWidgetPreset("clean");
    const publicConfig = mapAppearanceToPublicConfig({
      config,
      publishedVersion: 3,
      publishedAt: "2026-08-19T00:00:00.000Z",
      assets: { logoUrl: "https://cdn.example.com/logo.png" },
    });
    expect(publicConfig.version).toBe(3);
    expect(publicConfig.position).toBe("bottom-right");
    expect(publicConfig.branding.primaryColor).toBe(config.primaryColor);
    expect(publicConfig.logoUrl).toBe("https://cdn.example.com/logo.png");
    expect(widgetPublicAppearanceSchema.parse(publicConfig).greetingMessage.length).toBeGreaterThan(
      0,
    );
  });

  it("rejects every forbidden key at the public schema boundary", () => {
    const publicConfig = mapAppearanceToPublicConfig({
      config: applyWidgetPreset("clean"),
      publishedVersion: 3,
      publishedAt: "2026-08-19T00:00:00.000Z",
    });
    for (const key of PUBLIC_APPEARANCE_FORBIDDEN_KEYS) {
      expect(
        widgetPublicAppearanceSchema.safeParse({
          ...publicConfig,
          [key]: "must be rejected",
        }).success,
      ).toBe(false);
    }
  });
});

describe("locale overrides", () => {
  it("does not apply English override to Hebrew", () => {
    const text = resolveLocalizedCopy({
      copy: {
        useSystemDefaults: true,
        overrides: { en: "Hello custom" },
      },
      locale: "he",
      systemFallback: "שלום",
    });
    expect(text).toBe("שלום");
  });

  it("applies matching locale override", () => {
    const text = resolveLocalizedCopy({
      copy: {
        useSystemDefaults: true,
        overrides: { he: "היי מותאם", en: "Hello custom" },
      },
      locale: "he",
      systemFallback: "שלום",
    });
    expect(text).toBe("היי מותאם");
  });
});

describe("entitlements", () => {
  it("defaults grant studio features except custom_domain", () => {
    const entitlements = defaultWidgetStudioEntitlements();
    expect(hasWidgetStudioFeature(entitlements, "hide_powered_by")).toBe(true);
    expect(hasWidgetStudioFeature(entitlements, "custom_domain")).toBe(false);
  });

  it("fail-closed when grantedFeatures is empty", () => {
    const entitlements = resolveWidgetStudioEntitlements({ grantedFeatures: [] });
    expect(hasWidgetStudioFeature(entitlements, "basic_styling")).toBe(false);
  });

  it("forces powered-by when hide entitlement missing", () => {
    expect(
      resolveShowPoweredBy({
        configured: false,
        entitlements: resolveWidgetStudioEntitlements({ grantedFeatures: [] }),
      }),
    ).toBe(true);
  });
});

describe("merge and dirty", () => {
  it("merges patches and detects dirty drafts", () => {
    const base = defaultWidgetAppearanceConfig();
    const merged = mergeAppearanceConfig(base, { primaryColor: "#123456" });
    expect(merged.primaryColor).toBe("#123456");
    expect(isAppearanceDraftDirty(merged, base)).toBe(true);
    expect(isAppearanceDraftDirty(base, base)).toBe(false);
  });
});

describe("positioning", () => {
  it("uses physical left/right and clamps offsets", () => {
    const left = resolveLauncherPlacement({
      position: "bottom-left",
      offsetX: 999,
      offsetY: -10,
    });
    expect(left.style.left).toBe("120px");
    expect(left.style.bottom).toBe("0px");
    expect(left.style.right).toBe("auto");
  });
});

describe("business hours foundation", () => {
  it("treats disabled hours as always online", () => {
    expect(
      isWithinBusinessHours({
        enabled: false,
        timezone: "UTC",
        weekly: [],
      }),
    ).toBe(true);
  });

  it("returns offline when enabled with empty weekly", () => {
    expect(
      isWithinBusinessHours({
        enabled: true,
        timezone: "UTC",
        weekly: [],
      }),
    ).toBe(false);
  });
});
