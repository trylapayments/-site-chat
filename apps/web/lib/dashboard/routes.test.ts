import { describe, expect, it } from "vitest";

import {
  buildWorkspaceSwitchDestination,
  SETTINGS_SECTION_CANNED_RESPONSES,
  SETTINGS_SECTION_CRM,
  SETTINGS_SECTION_NOTIFICATIONS,
  workspaceBasePath,
  workspaceContactsPath,
  workspaceNavPath,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";

describe("workspaceNavPath", () => {
  it("builds workspace root and section paths", () => {
    expect(workspaceBasePath("acme")).toBe("/app/acme");
    expect(workspaceNavPath("acme", "")).toBe("/app/acme");
    expect(workspaceNavPath("acme", "inbox")).toBe("/app/acme/inbox");
  });
});

describe("workspaceSettingsPath", () => {
  it("builds the settings hub and section paths", () => {
    expect(workspaceSettingsPath("acme")).toBe("/app/acme/settings");
    expect(
      workspaceSettingsPath("acme", SETTINGS_SECTION_CANNED_RESPONSES),
    ).toBe("/app/acme/settings/canned-responses");
    expect(workspaceSettingsPath("acme", SETTINGS_SECTION_CRM)).toBe(
      "/app/acme/settings/crm",
    );
    expect(workspaceSettingsPath("acme", SETTINGS_SECTION_NOTIFICATIONS)).toBe(
      "/app/acme/settings/notifications",
    );
  });
});

describe("workspaceContactsPath", () => {
  it("builds contacts list and profile paths", () => {
    expect(workspaceContactsPath("acme")).toBe("/app/acme/contacts");
    expect(
      workspaceContactsPath("acme", "11111111-1111-4111-8111-111111111111"),
    ).toBe("/app/acme/contacts/11111111-1111-4111-8111-111111111111");
  });
});

describe("buildWorkspaceSwitchDestination", () => {
  it("preserves known top-level sections", () => {
    expect(
      buildWorkspaceSwitchDestination("/app/acme/inbox", "acme", "beta"),
    ).toBe("/app/beta/inbox");
    expect(
      buildWorkspaceSwitchDestination("/app/acme/settings", "acme", "beta"),
    ).toBe("/app/beta/settings");
  });

  it("preserves known sections when deeper paths are present", () => {
    expect(
      buildWorkspaceSwitchDestination(
        "/app/acme/inbox/conversation-123",
        "acme",
        "beta",
      ),
    ).toBe("/app/beta/inbox");
  });

  it("falls back to workspace home for unknown sections", () => {
    expect(
      buildWorkspaceSwitchDestination("/app/acme/unknown", "acme", "beta"),
    ).toBe("/app/beta");
  });

  it("falls back when the current path does not match the source slug", () => {
    expect(
      buildWorkspaceSwitchDestination("/app/other/inbox", "acme", "beta"),
    ).toBe("/app/beta");
  });

  it("maps workspace root to the target workspace root", () => {
    expect(buildWorkspaceSwitchDestination("/app/acme", "acme", "beta")).toBe(
      "/app/beta",
    );
    expect(buildWorkspaceSwitchDestination("/app/acme/", "acme", "beta")).toBe(
      "/app/beta",
    );
  });
});
