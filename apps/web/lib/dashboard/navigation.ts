import {
  DASHBOARD_NAV_ITEMS,
  workspaceBasePath,
  workspaceNavPath,
  type DashboardNavItemId,
} from "@/lib/dashboard/routes";

export type DashboardNavLinkItem = {
  id: DashboardNavItemId;
  label: string;
  href: string;
  icon: (typeof DASHBOARD_NAV_ITEMS)[number]["icon"];
};

export function buildDashboardNavItems(slug: string): DashboardNavLinkItem[] {
  return DASHBOARD_NAV_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    href: workspaceNavPath(slug, item.segment),
    icon: item.icon,
  }));
}

export function resolveActiveNavItemId(
  pathname: string,
  slug: string,
): DashboardNavItemId | null {
  const basePath = workspaceBasePath(slug);

  if (pathname === basePath || pathname === `${basePath}/`) {
    return "overview";
  }

  for (const item of DASHBOARD_NAV_ITEMS) {
    if (item.segment.length === 0) {
      continue;
    }

    const itemPath = workspaceNavPath(slug, item.segment);
    if (pathname === itemPath || pathname.startsWith(`${itemPath}/`)) {
      return item.id;
    }
  }

  return null;
}

export function resolveSectionLabel(
  activeNavItemId: DashboardNavItemId | null,
): string | null {
  if (!activeNavItemId) {
    return null;
  }

  const item = DASHBOARD_NAV_ITEMS.find(
    (entry) => entry.id === activeNavItemId,
  );
  return item?.label ?? null;
}
