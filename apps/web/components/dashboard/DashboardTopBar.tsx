"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import type { AccessibleWorkspace } from "@site-chat/shared";

import { GlobalSearch } from "@/components/dashboard/global-search/GlobalSearch";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { NotificationBell } from "@/components/dashboard/notifications/NotificationBell";

export function DashboardTopBar({
  slug,
  workspaces,
  currentWorkspaceId,
  memberId,
  email,
  canAdministerPlatform = false,
  canSearchNotes,
}: {
  slug: string;
  workspaces: AccessibleWorkspace[];
  currentWorkspaceId: string;
  memberId: string;
  email: string;
  canAdministerPlatform?: boolean;
  canSearchNotes: boolean;
}) {
  const pathname = usePathname();
  const segment = pathname
    .split(`/app/${slug}`)[1]
    ?.split("/")
    .filter(Boolean)[0];
  const section = segment
    ? segment.charAt(0).toUpperCase() + segment.slice(1).replaceAll("-", " ")
    : "Overview";
  return (
    <header className="mill-topbar border-border flex h-14 shrink-0 items-center gap-3 border-b bg-inbox-panel px-4">
      <MobileNav
        slug={slug}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        memberId={memberId}
        email={email}
        canAdministerPlatform={canAdministerPlatform}
      />
      <div className="mill-breadcrumb hidden items-center gap-2 text-xs md:flex">
        <span>Workspace</span>
        <ChevronRight className="size-3" aria-hidden="true" />
        <strong>{section}</strong>
      </div>
      <div className="ml-auto min-w-0">
        <GlobalSearch workspaceSlug={slug} canSearchNotes={canSearchNotes} />
      </div>
      <div className="flex items-center gap-2">
        {memberId ? (
          <NotificationBell
            workspaceSlug={slug}
            workspaceId={currentWorkspaceId}
            memberId={memberId}
          />
        ) : null}
      </div>
    </header>
  );
}
