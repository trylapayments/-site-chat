import type { AccessibleWorkspace, MemberRole } from "@site-chat/shared";
import { can } from "@site-chat/shared";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";

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
  const canSearchNotes = can(role, "manage_internal_notes");

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
