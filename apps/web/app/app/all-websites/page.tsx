import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { fetchLastWorkspaceId } from "@/lib/workspace/queries";
import { fetchAccessibleWorkspaces } from "@/lib/workspace/queries";
import { allConversations, workspaceInboxes } from "@/lib/company/inboxes";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PortalDataProvider } from "@/components/dashboard/PortalDataProvider";
import { PortalWorkArea } from "@/components/dashboard/PortalWorkArea";
import { AllWebsitesInbox } from "@/components/inbox/workspace/AllWebsitesInbox";
export default async function AllWebsitesPage() {
  const client = await createClient();
  const { user } = await requireUser(client);
  if (!user) redirect("/login");
  const [
    { accessible_workspaces: workspaces },
    inboxes,
    initial,
    lastWorkspaceId,
  ] = await Promise.all([
    fetchAccessibleWorkspaces(client),
    workspaceInboxes(client),
    allConversations(client, {
      page: 1,
      pageSize: 25,
      statusGroup: "active",
      assignment: "all",
    }),
    fetchLastWorkspaceId(client),
  ]);
  const summary =
    inboxes.workspaces.find((w) => w.workspace_id === lastWorkspaceId) ??
    inboxes.workspaces[0];
  const workspace = workspaces.find(
    (w) => w.workspace_id === summary?.workspace_id,
  );
  if (!workspace || !summary) redirect("/app");
  return (
    <PortalDataProvider
      userId={user.id}
      slug={workspace.slug}
      workspaceId={workspace.workspace_id}
      memberId={summary.member_id}
      role={workspace.role}
    >
      <DashboardShell
        slug={workspace.slug}
        workspaceName={workspace.name}
        workspaceId={workspace.workspace_id}
        memberId={summary.member_id}
        workspaces={workspaces}
        email={user.email ?? ""}
        role={workspace.role}
      >
        <PortalWorkArea>
          <AllWebsitesInbox initial={initial} inboxes={inboxes} />
        </PortalWorkArea>
      </DashboardShell>
    </PortalDataProvider>
  );
}
