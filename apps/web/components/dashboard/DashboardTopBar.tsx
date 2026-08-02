"use client";

import { usePathname } from "next/navigation";

import type { AccessibleWorkspace } from "@site-chat/shared";

import { MobileNav } from "@/components/dashboard/MobileNav";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";

export function DashboardTopBar({
  slug,
  workspaces,
  currentWorkspaceId,
  email,
}: {
  slug: string;
  workspaces: AccessibleWorkspace[];
  currentWorkspaceId: string;
  email: string;
}) {
  const pathname = usePathname();

  return (
    <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <MobileNav
        slug={slug}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        email={email}
      />
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden lg:block">
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            currentPath={pathname}
          />
        </div>
        <div className="hidden lg:block">
          <UserMenu email={email} />
        </div>
      </div>
    </header>
  );
}
