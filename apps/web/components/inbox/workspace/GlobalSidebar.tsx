"use client";

import {
  MILL_DIALOGUE_MARK,
  type AccessibleWorkspace,
} from "@site-chat/shared";
import {
  Bookmark,
  ContactRound,
  Radar,
  CheckCheck,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  UserCog,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { OperatorAvailability } from "@/components/dashboard/OperatorAvailability";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import { InboxUnreadBadge } from "@/components/inbox/InboxUnreadBadge";
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
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean;
    strokeWidth?: number;
  }>;
  showUnread?: boolean;
  match?: "exact" | "prefix" | "assignment";
  assignment?: string;
};

function buildInboxNav(slug: string): NavItem[] {
  const inbox = workspaceNavPath(slug, "inbox");
  return [
    {
      id: "overview",
      label: "Overview",
      href: workspaceNavPath(slug, ""),
      icon: LayoutDashboard,
      match: "exact",
    },
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
      label: "Assigned to me",
      href: `${inbox}?assignment=assigned_to_me`,
      icon: MessageSquareText,
      match: "assignment",
      assignment: "assigned_to_me",
    },
    {
      id: "closed",
      label: "Closed",
      href: `${inbox}?status=closed`,
      icon: CheckCheck,
      match: "prefix",
    },
    {
      id: "visitors",
      label: "Visitors",
      href: workspaceNavPath(slug, "visitors"),
      icon: Radar,
      match: "prefix",
    },
    {
      id: "contacts",
      label: "Contacts",
      href: workspaceNavPath(slug, "contacts"),
      icon: ContactRound,
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

  const onInbox = appPath === inboxBase || appPath.startsWith(`${inboxBase}/`);
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
  const closed = searchParams.get("status") === "closed";
  const settingsHref = toAppRoute(workspaceNavPath(slug, "settings"));

  return (
    <aside
      className="mill-sidebar bg-inbox-nav border-inbox-nav-border border-r text-inbox-nav-foreground flex h-full w-[208px] shrink-0 flex-col"
      data-testid="inbox-global-sidebar"
      aria-label="Workspace"
    >
      <div className="border-inbox-nav-border flex items-center gap-3 border-b px-4 py-5">
        {/* Shared approved Mill mark; not a replacement initial. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- inline brand asset */}
        <img src={MILL_DIALOGUE_MARK} alt="" className="size-10 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-[24px] font-semibold tracking-tight">
            Mill
          </p>
          <p className="text-inbox-nav-muted truncate text-[12px]">
            {workspaceName}
          </p>
        </div>
      </div>

      <nav
        className="flex-1 space-y-1 overflow-y-auto px-2.5 py-4"
        aria-label="Main"
      >
        {items.map((item) => {
          const active =
            item.id === "closed"
              ? closed &&
                pathname.startsWith(toAppRoute(workspaceNavPath(slug, "inbox")))
              : !(item.match === "assignment" && closed) &&
                isNavActive(item, pathname, assignment, slug);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              data-nav-item={item.id}
              href={toAppRoute(item.href)}
              prefetch={item.id === "team" ? false : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
                active
                  ? "bg-inbox-nav-active text-white"
                  : "text-inbox-nav-muted hover:bg-inbox-nav-hover hover:text-inbox-nav-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  active ? "text-white" : "text-brand",
                )}
                strokeWidth={1.75}
                aria-hidden={true}
              />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.showUnread && workspaceId && memberId ? (
                <InboxUnreadBadge
                  workspaceId={workspaceId}
                  memberId={memberId}
                  className={cn(
                    "ml-auto",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-brand-soft text-brand",
                  )}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-inbox-nav-border mt-auto space-y-2 border-t px-2.5 py-3.5">
        <div className="px-1 [&_button]:border-inbox-border [&_button]:bg-transparent [&_button]:text-inbox-nav-foreground [&_button]:hover:bg-inbox-nav-hover">
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentWorkspaceId={workspaceId}
            currentPath={pathname}
          />
        </div>
        <Link
          href={settingsHref}
          className={cn(
            "text-inbox-nav-muted hover:bg-inbox-nav-hover hover:text-inbox-nav-foreground flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
            pathname.startsWith(settingsHref) &&
              "bg-inbox-nav-active text-inbox-nav-foreground",
          )}
        >
          <Settings
            className="size-[18px] shrink-0 opacity-75"
            strokeWidth={1.75}
            aria-hidden={true}
          />
          Settings
        </Link>
        <div className="px-1 pt-1 [&_button]:border-inbox-border [&_button]:bg-transparent [&_button]:text-inbox-nav-foreground [&_button]:hover:bg-inbox-nav-hover">
          {workspaces.some(
            (workspace) =>
              workspace.workspace_id === workspaceId &&
              workspace.role !== "viewer",
          ) ? (
            <OperatorAvailability key={slug} slug={slug} />
          ) : null}
          <UserMenu email={email} />
        </div>
      </div>
    </aside>
  );
}
