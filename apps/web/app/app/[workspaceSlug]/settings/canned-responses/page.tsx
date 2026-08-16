import { can, cannedResponsesMessagesEn } from "@site-chat/shared";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { CannedResponsesManager } from "@/components/settings/CannedResponsesManager";
import { requireUser } from "@/lib/auth/session";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireCannedWorkspace } from "@/lib/canned/guards";
import { fetchCannedResponses } from "@/lib/canned/queries";
import { workspaceSettingsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";

const messages = cannedResponsesMessagesEn;

export default async function CannedResponsesSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireCannedWorkspace(workspaceSlug);
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

  const library = await fetchCannedResponses(supabase, workspace.workspace_id, {
    limit: 200,
    include_folders: true,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title={messages.pageTitle}
        description={messages.pageDescription}
      />
      <Link
        href={toAppRoute(workspaceSettingsPath(workspaceSlug))}
        className="text-primary text-sm font-medium hover:underline"
      >
        Back to settings
      </Link>

      <CannedResponsesManager
        workspaceId={workspace.workspace_id}
        workspaceSlug={workspaceSlug}
        memberId={memberId}
        initialResponses={library.items}
        initialFolders={library.folders ?? []}
        initialHasMore={library.has_more}
        canUse={can(workspace.role, "use_canned_responses")}
        canManageWorkspace={can(
          workspace.role,
          "manage_workspace_canned_responses",
        )}
      />
    </div>
  );
}
