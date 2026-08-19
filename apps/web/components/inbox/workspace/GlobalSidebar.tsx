"use client";

import type { AccessibleWorkspace } from "@site-chat/shared";
import {
  Bookmark,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  UserCog,
  Users,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { InboxUnreadBadge } from "@/components/inbox/InboxUnreadBadge";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import { toAppRoute } from "@/lib/auth/redirect";
import {
  SETTINGS_SECTION_CANNED_RESPONSES,
  workspaceNavPath,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";
import { cn } from "@/lib/utils";

type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  showUnread?: boolean;
  match?: "exact" | "prefix" | "assignment";
  assignment?: string;
};

function buildInboxNav(slug: string): NavItem[] {
  const inbox = workspaceNavPath(slug, "inbox");
  return [
    {
      id: "inbox",
      label: "Inbox",
      href: inbox,
      icon: Inbox,
      showUnread: true,
      match: "assignment",
      assignment: "all",
    },
    {
      id: "unassigned",
      label: "Unassigned",
      href: `${inbox}?assignment=unassigned`,
      icon: UserX,
      match: "assignment",
      assignment: "unassigned",
    },
    {
      id: "mine",
      label: "Mine",
      href: `${inbox}?assignment=assigned_to_me`,
      icon: MessageSquareText,
      match: "assignment",
      assignment: "assigned_to_me",
    },
    {
      id: "contacts",
      label: "Contacts",
      href: workspaceNavPath(slug, "contacts"),
      icon: Users,
      match: "prefix",
    },
    {
      id: "team",
      label: "Team",
      href: workspaceNavPath(slug, "team"),
      icon: UserCog,
      match: "prefix",
    },
    {
      id: "templates",
      label: "Templates",
      href: workspaceSettingsPath(slug, SETTINGS_SECTION_CANNED_RESPONSES),
      icon: Bookmark,
      match: "prefix",
    },
    {
      id: "overview",
      label: "Overview",
      href: workspaceNavPath(slug, ""),
      icon: LayoutDashboard,
      match: "exact",
    },
  ];
}

function isNavActive(
  item: NavItem,
  pathname: string,
  assignment: string | null,
  slug: string,
): boolean {
  const inboxBase = toAppRoute(workspaceNavPath(slug, "inbox"));
  const appPath = pathname.startsWith("/app")
    ? pathname
    : pathname.replace(/^/, "");

  if (item.match === "exact") {
    const target = toAppRoute(item.href);
    return appPath === target || appPath === `${target}/`;
  }

  if (item.match === "prefix") {
    const target = toAppRoute(item.href.split("?")[0] ?? item.href);
    return appPath === target || appPath.startsWith(`${target}/`);
  }

  // assignment match — only when on inbox routes
  const onInbox =
    appPath === inboxBase || appPath.startsWith(`${inboxBase}/`);
  if (!onInbox) {
    return false;
  }

  const current = assignment ?? "all";
  const wanted = item.assignment ?? "all";
  if (wanted === "all") {
    return current === "all" || current === "";
  }
  return current === wanted;
}

export function GlobalSidebar({
  workspaceName,
  slug,
  workspaceId,
  memberId,
  workspaces,
  email,
}: {
  workspaceName: string;
  slug: string;
  workspaceId: string;
  memberId: string;
  workspaces: AccessibleWorkspace[];
  email: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const assignment = searchParams.get("assignment");
  const items = buildInboxNav(slug);
  const settingsHref = toAppRoute(workspaceNavPath(slug, "settings"));

  return (
    <aside
      className="bg-inbox-nav text-inbox-nav-foreground flex h-full w-[220px] shrink-0 flex-col"
      data-testid="inbox-global-sidebar"
      aria-label="Workspace"
    >
      <div className="border-inbox-nav-border flex items-center gap-2.5 border-b px-4 py-4">
        <div
          className="bg-brand flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
          aria-hidden="true"
        >
          SC
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">
            Site Chat
          </p>
          <p className="text-inbox-nav-muted truncate text-[11px]">
            {workspaceName}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {items.map((item) => {
          const active = isNavActive(item, pathname, assignment, slug);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={toAppRoute(item.href)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-brand text-white shadow-sm"
                  : "text-inbox-nav-muted hover:bg-inbox-nav-hover hover:text-inbox-nav-foreground",
              )}
            >
              <Icon className="size-4 shrink-0 opacity-90" aria-hidden={true} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.showUnread && workspaceId && memberId ? (
                <InboxUnreadBadge
                  workspaceId={workspaceId}
                  memberId={memberId}
                  className={cn(
                    "ml-auto",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-brand text-white",
                  )}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-inbox-nav-border space-y-2 border-t px-2.5 py-3">
        <div className="px-1 [&_button]:border-white/15 [&_button]:bg-transparent [&_button]:text-inbox-nav-foreground [&_button]:hover:bg-inbox-nav-hover">
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentWorkspaceId={workspaceId}
            currentPath={pathname}
          />
        </div>
        <Link
          href={settingsHref}
          className={cn(
            "text-inbox-nav-muted hover:bg-inbox-nav-hover hover:text-inbox-nav-foreground flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
            pathname.startsWith(settingsHref) &&
              "bg-inbox-nav-hover text-inbox-nav-foreground",
          )}
        >
          <Settings className="size-4 shrink-0" aria-hidden={true} />
          Settings
        </Link>
        <div className="px-1 pt-1 [&_button]:border-white/15 [&_button]:bg-transparent [&_button]:text-inbox-nav-foreground [&_button]:hover:bg-inbox-nav-hover">
          <UserMenu email={email} />
        </div>
      </div>
    </aside>
  );
}
