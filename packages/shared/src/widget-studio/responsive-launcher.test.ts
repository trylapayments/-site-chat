import { describe, it, expect } from "vitest";
import { defaultWidgetAppearanceConfig } from "./defaults";
import { widgetAppearanceConfigSchema } from "./schema";
import { mapAppearanceToPublicConfig } from "./public-config";
describe("responsive launchers", () => {
  it("old configs acquire compatible defaults", () => {
    const old = { ...defaultWidgetAppearanceConfig() } as Record<string, unknown>;
    delete old.launcherText;
    delete old.launcherWidth;
    delete old.mobileLauncher;
    expect(widgetAppearanceConfigSchema.parse(old)).toMatchObject({
      launcherText: "Online chat",
      launcherWidth: 180,
      mobileLauncher: null,
    });
  });
  it("publishes separate mobile settings without overwriting desktop", () => {
    const config = defaultWidgetAppearanceConfig();
    config.launcherShape = "rectangle";
    config.launcherWidth = 220;
    config.mobileLauncher = {
      launcherShape: "circle",
      launcherSize: "sm",
      launcherText: "Talk to us",
      launcherWidth: 160,
      launcherColor: "#123456",
      launcherPosition: "bottom-left",
      launcherOffsetX: 8,
      launcherOffsetY: 12,
    };
    const dto = mapAppearanceToPublicConfig({
      config,
      publishedVersion: 1,
      publishedAt: "2026-10-05T18:00:00Z",
    });
    expect(dto.launcherShape).toBe("rectangle");
    expect(dto.mobileLauncher?.launcherShape).toBe("circle");
    expect(dto.mobileLauncher?.launcherPosition).toBe("bottom-left");
  });
  it("rejects unbounded width and script fields", () => {
    const config = defaultWidgetAppearanceConfig();
    expect(widgetAppearanceConfigSchema.safeParse({ ...config, launcherWidth: 900 }).success).toBe(
      false,
    );
    expect(
      widgetAppearanceConfigSchema.safeParse({ ...config, mobileLauncher: { customJS: "evil" } })
        .success,
    ).toBe(false);
  });
});
