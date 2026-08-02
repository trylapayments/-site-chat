import { describe, expect, it } from "vitest";

import {
  buildDashboardNavItems,
  resolveActiveNavItemId,
  resolveSectionLabel,
} from "@/lib/dashboard/navigation";

describe("buildDashboardNavItems", () => {
  it("generates navigation links from the shared route constants", () => {
    expect(buildDashboardNavItems("acme")).toEqual([
      {
        id: "overview",
        label: "Overview",
        href: "/app/acme",
        icon: "LayoutDashboard",
      },
      {
        id: "inbox",
        label: "Inbox",
        href: "/app/acme/inbox",
        icon: "Inbox",
      },
      {
        id: "contacts",
        label: "Contacts",
        href: "/app/acme/contacts",
        icon: "Users",
      },
      {
        id: "team",
        label: "Team",
        href: "/app/acme/team",
        icon: "UserCog",
      },
      {
        id: "settings",
        label: "Settings",
        href: "/app/acme/settings",
        icon: "Settings",
      },
    ]);
  });
});

describe("resolveActiveNavItemId", () => {
  it("detects the active section including nested paths", () => {
    expect(resolveActiveNavItemId("/app/acme", "acme")).toBe("overview");
    expect(resolveActiveNavItemId("/app/acme/", "acme")).toBe("overview");
    expect(resolveActiveNavItemId("/app/acme/inbox", "acme")).toBe("inbox");
    expect(resolveActiveNavItemId("/app/acme/inbox/123", "acme")).toBe("inbox");
    expect(resolveActiveNavItemId("/app/acme/settings/profile", "acme")).toBe(
      "settings",
    );
  });

  it("returns null for unknown paths", () => {
    expect(resolveActiveNavItemId("/app/acme/unknown", "acme")).toBeNull();
    expect(resolveActiveNavItemId("/app/other/inbox", "acme")).toBeNull();
  });
});

describe("resolveSectionLabel", () => {
  it("returns labels from the shared navigation constants", () => {
    expect(resolveSectionLabel("inbox")).toBe("Inbox");
    expect(resolveSectionLabel(null)).toBeNull();
  });
});
