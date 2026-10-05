import { can } from "@site-chat/shared";
import { ChatSetupEditor } from "@/components/settings/chat-setup/ChatSetupEditor";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
export default async function ChatSetupPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWidgetStudioWorkspace(workspaceSlug);
  const state = await fetchChatSetup(workspace.workspace_id);
  return (
    <ChatSetupEditor
      slug={workspaceSlug}
      initial={state}
      workspaceName={workspace.name}
      canManage={can(workspace.role, "manage_widget_studio")}
    />
  );
}
