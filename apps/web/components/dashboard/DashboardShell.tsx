import type { AccessibleWorkspace } from "@site-chat/shared";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";

export function DashboardShell({
  slug,
  workspaceName,
  workspaceId,
  workspaces,
  email,
  children,
}: {
  slug: string;
  workspaceName: string;
  workspaceId: string;
  workspaces: AccessibleWorkspace[];
  email: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background flex min-h-screen">
      <DashboardSidebar workspaceName={workspaceName} slug={slug} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar
          slug={slug}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          email={email}
        />
        <main id="main-content" className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
