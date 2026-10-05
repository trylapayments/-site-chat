"use client";

import type { AccessibleWorkspace, MemberRole } from "@site-chat/shared";
import { can } from "@site-chat/shared";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type CSSProperties } from "react";

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
  canAdministerPlatform = false,
  role,
  children,
}: {
  slug: string;
  workspaceName: string;
  workspaceId: string;
  memberId: string;
  workspaces: AccessibleWorkspace[];
  email: string;
  canAdministerPlatform?: boolean;
  role: MemberRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileHeight, setMobileHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      setMobileHeight(
        window.innerWidth < 1024
          ? (viewport?.height ?? window.innerHeight)
          : null,
      );
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
    };
  }, []);
  const canSearchNotes = can(role, "manage_internal_notes");
  const inboxBase = `/app/${slug}/inbox`;
  const isInbox =
    pathname === inboxBase || pathname.startsWith(`${inboxBase}/`);
  const isContacts = pathname.startsWith(`/app/${slug}/contacts`);
  const isTeam = pathname.startsWith(`/app/${slug}/team`);
  const isVisitors = pathname === `/app/${slug}/visitors`;
  const useOperatorWorkspaceChrome =
    isInbox || isContacts || isTeam || isVisitors;

  if (useOperatorWorkspaceChrome) {
    // h-svh (small viewport) — not h-dvh. Safari's dynamic viewport tracks
    // the URL/toolbar chrome; nesting that under /app min-height:100vh made a
    // document scrollbar appear/disappear and shift the whole 3-column page.
    return (
      <div
        className="mill-operator bg-inbox-canvas flex h-[var(--operator-mobile-height,100svh)] overflow-hidden lg:h-svh"
        style={
          mobileHeight === null
            ? undefined
            : ({
                "--operator-mobile-height": `${String(mobileHeight)}px`,
              } as CSSProperties)
        }
        data-testid="dashboard-operator-shell"
      >
        <div className="hidden lg:flex">
          <Suspense fallback={<div className="bg-inbox-nav w-[208px]" />}>
            <GlobalSidebar
              workspaceName={workspaceName}
              slug={slug}
              workspaceId={workspaceId}
              memberId={memberId}
              workspaces={workspaces}
              email={email}
              canAdministerPlatform={canAdministerPlatform}
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
              canAdministerPlatform={canAdministerPlatform}
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
    <div className="mill-operator bg-inbox-canvas flex h-svh overflow-hidden">
      <div className="hidden lg:flex">
        <Suspense fallback={<div className="bg-inbox-nav w-[208px]" />}>
          <GlobalSidebar
            workspaceName={workspaceName}
            slug={slug}
            workspaceId={workspaceId}
            memberId={memberId}
            workspaces={workspaces}
            email={email}
            canAdministerPlatform={canAdministerPlatform}
          />
        </Suspense>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar
          slug={slug}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          memberId={memberId}
          email={email}
          canAdministerPlatform={canAdministerPlatform}
          canSearchNotes={canSearchNotes}
        />
        <main
          id="main-content"
          className="mill-page min-h-0 flex-1 overflow-y-auto p-4 md:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
