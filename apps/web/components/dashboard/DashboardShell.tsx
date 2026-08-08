import type { AccessibleWorkspace } from "@site-chat/shared";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";

export function DashboardShell({
  slug,
  workspaceName,
  workspaceId,
  memberId,
  workspaces,
  email,
  children,
}: {
  slug: string;
  workspaceName: string;
  workspaceId: string;
  memberId: string;
  workspaces: AccessibleWorkspace[];
  email: string;
  children: React.ReactNode;
}) {
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
        />
        <main id="main-content" className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
