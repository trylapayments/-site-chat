export type DashboardNavIconKey =
  "LayoutDashboard" | "Inbox" | "Users" | "UserCog" | "Settings";

export type DashboardNavItemId =
  "overview" | "inbox" | "contacts" | "team" | "settings";

export type DashboardNavItem = {
  id: DashboardNavItemId;
  label: string;
  segment: string;
  icon: DashboardNavIconKey;
};

export const DASHBOARD_NAV_ITEMS = [
  {
    id: "overview",
    label: "Overview",
    segment: "",
    icon: "LayoutDashboard",
  },
  {
    id: "inbox",
    label: "Inbox",
    segment: "inbox",
    icon: "Inbox",
  },
  {
    id: "contacts",
    label: "Contacts",
    segment: "contacts",
    icon: "Users",
  },
  {
    id: "team",
    label: "Team",
    segment: "team",
    icon: "UserCog",
  },
  {
    id: "settings",
    label: "Settings",
    segment: "settings",
    icon: "Settings",
  },
] as const satisfies readonly DashboardNavItem[];

const PRESERVABLE_SEGMENTS: ReadonlySet<string> = new Set(
  DASHBOARD_NAV_ITEMS.map((item) => item.segment).filter(
    (segment) => segment.length > 0,
  ),
);

export function workspaceBasePath(slug: string): string {
  return `/app/${slug}`;
}

export function workspaceNavPath(slug: string, segment: string): string {
  if (segment.length === 0) {
    return workspaceBasePath(slug);
  }

  return `${workspaceBasePath(slug)}/${segment}`;
}

export const SETTINGS_SECTION_CANNED_RESPONSES = "canned-responses";
export const SETTINGS_SECTION_CRM = "crm";
export const SETTINGS_SECTION_NOTIFICATIONS = "notifications";

export function workspaceSettingsPath(slug: string, section?: string): string {
  const settings = workspaceNavPath(slug, "settings");

  if (!section || section.length === 0) {
    return settings;
  }

  return `${settings}/${section}`;
}

export function workspaceContactsPath(
  slug: string,
  contactId?: string,
): string {
  const contacts = workspaceNavPath(slug, "contacts");
  if (!contactId) {
    return contacts;
  }
  return `${contacts}/${contactId}`;
}

export function buildWorkspaceSwitchDestination(
  currentPath: string,
  fromSlug: string,
  toSlug: string,
): string {
  const prefix = workspaceBasePath(fromSlug);

  if (currentPath === prefix || currentPath === `${prefix}/`) {
    return workspaceBasePath(toSlug);
  }

  if (!currentPath.startsWith(`${prefix}/`)) {
    return workspaceBasePath(toSlug);
  }

  const remainder = currentPath.slice(prefix.length + 1);
  const firstSegment = remainder.split("/")[0] ?? "";

  if (PRESERVABLE_SEGMENTS.has(firstSegment)) {
    return workspaceNavPath(toSlug, firstSegment);
  }

  return workspaceBasePath(toSlug);
}
