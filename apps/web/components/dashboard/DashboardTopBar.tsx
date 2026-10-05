"use client";

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
  return (
    <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b bg-inbox-panel px-4">
      <MobileNav
        slug={slug}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        memberId={memberId}
        email={email}
        canAdministerPlatform={canAdministerPlatform}
      />
      <div className="min-w-0 flex-1">
        <GlobalSearch workspaceSlug={slug} canSearchNotes={canSearchNotes} />
      </div>
      <div className="ml-auto flex items-center gap-2">
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
