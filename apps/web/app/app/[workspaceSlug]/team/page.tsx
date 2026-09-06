import { can } from "@site-chat/shared";
import type { ListWorkspaceTeamResult } from "@site-chat/shared/team";

import { TeamShell } from "@/components/team/TeamShell";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { requireTeamWorkspace } from "@/lib/team/guards";
import { fetchWorkspaceTeam } from "@/lib/team/queries";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireTeamWorkspace(workspaceSlug);
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  let memberId = "";
  if (user) {
    const { data: memberRow } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspace.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();
    memberId = memberRow?.id ?? "";
  }

  let team: ListWorkspaceTeamResult = { members: [], invitations: [] };
  let loadError = false;
  try {
    team = await fetchWorkspaceTeam(supabase, workspace.workspace_id);
  } catch {
    loadError = true;
  }

  return (
    <TeamShell
      workspaceId={workspace.workspace_id}
      workspaceSlug={workspaceSlug}
      memberId={memberId}
      callerRole={workspace.role}
      canSearchNotes={can(workspace.role, "manage_internal_notes")}
      initialTeam={team}
      loadError={loadError}
    />
  );
}
