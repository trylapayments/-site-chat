import { can } from "@site-chat/shared";
import { VisitorsPanel } from "@/components/visitors/VisitorsPanel";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { listVisitorsAction } from "@/lib/visitors/actions";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
export default async function VisitorsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  const [visitors, settings] = await Promise.all([
    listVisitorsAction(workspaceSlug),
    fetchChatSetup(workspace.workspace_id),
  ]);
  return (
    <VisitorsPanel
      slug={workspaceSlug}
      initial={visitors}
      standardMessage={settings.config.invitationMessage}
      canSend={can(workspace.role, "send_messages")}
    />
  );
}
