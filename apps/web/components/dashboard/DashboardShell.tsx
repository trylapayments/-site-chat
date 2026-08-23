"use client";

import type { AccessibleWorkspace, MemberRole } from "@site-chat/shared";
import { can } from "@site-chat/shared";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { GlobalSidebar } from "@/components/inbox/workspace/GlobalSidebar";

export function DashboardShell({
  slug,
  workspaceName,
  workspaceId,
  memberId,
  workspaces,
  email,
  role,
  children,
}: {
  slug: string;
  workspaceName: string;
  workspaceId: string;
  memberId: string;
  workspaces: AccessibleWorkspace[];
  email: string;
  role: MemberRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const canSearchNotes = can(role, "manage_internal_notes");
  const inboxBase = `/app/${slug}/inbox`;
  const isInbox =
    pathname === inboxBase || pathname.startsWith(`${inboxBase}/`);

  if (isInbox) {
    return (
      <div className="bg-inbox-canvas flex h-dvh overflow-hidden">
        <div className="hidden lg:flex">
          <Suspense fallback={<div className="bg-inbox-nav w-[220px]" />}>
            <GlobalSidebar
              workspaceName={workspaceName}
              slug={slug}
              workspaceId={workspaceId}
              memberId={memberId}
              workspaces={workspaces}
              email={email}
            />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-inbox-border flex h-12 shrink-0 items-center gap-2 border-b bg-inbox-panel px-3 lg:hidden">
            <MobileNav
              slug={slug}
              workspaces={workspaces}
              currentWorkspaceId={workspaceId}
              memberId={memberId}
              email={email}
            />
            <p className="truncate text-sm font-semibold">{workspaceName}</p>
          </div>
          <main id="main-content" className="min-h-0 flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen">
      <DashboardSidebar
        workspaceName={workspaceName}
        slug={slug}
        workspaceId={workspaceId}
        memberId={memberId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar
          slug={slug}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          memberId={memberId}
          email={email}
          canSearchNotes={canSearchNotes}
        />
        <main id="main-content" className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
