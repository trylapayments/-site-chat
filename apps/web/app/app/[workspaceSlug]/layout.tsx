import { notFound, redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    redirect(toAppRoute("/login"));
  }

  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(
    workspaceSlug,
    membership.accessible_workspaces,
  );

  if (!guard.ok) {
    if (
      membership.total_membership_count > 0 &&
      membership.accessible_workspaces.length === 0
    ) {
      redirect(toAppRoute("/app/unavailable"));
    }

    notFound();
  }

  const { data: memberRow } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", guard.workspace.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  return (
    <DashboardShell
      slug={guard.workspace.slug}
      workspaceName={guard.workspace.name}
      workspaceId={guard.workspace.workspace_id}
      memberId={memberRow?.id ?? ""}
      workspaces={membership.accessible_workspaces}
      email={user.email ?? "Signed in"}
      role={guard.workspace.role}
    >
      {children}
    </DashboardShell>
  );
}
