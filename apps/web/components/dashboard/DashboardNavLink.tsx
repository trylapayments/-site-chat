"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { toAppRoute } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ICONS } from "@/lib/dashboard/icons";
import { resolveActiveNavItemId } from "@/lib/dashboard/navigation";
import type { DashboardNavLinkItem } from "@/lib/dashboard/navigation";

export function DashboardNavLink({
  item,
  slug,
  onNavigate,
}: {
  item: DashboardNavLinkItem;
  slug: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeNavItemId = resolveActiveNavItemId(pathname, slug);
  const isActive = activeNavItemId === item.id;
  const Icon = DASHBOARD_NAV_ICONS[item.icon];

  return (
    <Link
      href={toAppRoute(item.href)}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}
