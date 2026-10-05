import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { workspaceWidgetStudioEntitlements } from "./entitlements.server";
afterEach(() => vi.unstubAllEnvs());
it("grants the complete studio only to explicitly configured pilot workspaces", () => {
  vi.stubEnv("MILL_FULL_FEATURE_WORKSPACE_IDS", " pilot-a, pilot-b ");
  expect(
    workspaceWidgetStudioEntitlements("pilot-a").features.has(
      "hide_powered_by",
    ),
  ).toBe(true);
  expect(
    workspaceWidgetStudioEntitlements("pilot-b").features.has("custom_domain"),
  ).toBe(true);
  expect(
    workspaceWidgetStudioEntitlements("other").features.has("hide_powered_by"),
  ).toBe(false);
  vi.stubEnv("MILL_FULL_FEATURE_WORKSPACE_IDS", "");
  expect(
    workspaceWidgetStudioEntitlements("pilot-a").features.has(
      "hide_powered_by",
    ),
  ).toBe(false);
});
