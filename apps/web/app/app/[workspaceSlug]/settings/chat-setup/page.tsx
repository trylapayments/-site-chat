import { effectiveWidgetEntitlements } from "@/lib/platform-admin/access";
import { fetchWidgetStudioState } from "@/lib/widget-studio/queries";
import { createClient } from "@/lib/supabase/server";
import { resolveShowPoweredBy, can } from "@site-chat/shared";
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
  const [state, appearance] = await Promise.all([
    fetchChatSetup(workspace.workspace_id),
    fetchWidgetStudioState(await createClient(), workspace.workspace_id),
  ]);
  return (
    <ChatSetupEditor
      slug={workspaceSlug}
      initial={state}
      workspaceName={workspace.name}
      showPoweredBy={resolveShowPoweredBy({
        configured: appearance.published.showPoweredBy,
        entitlements: await effectiveWidgetEntitlements(workspace.workspace_id),
      })}
      canManage={can(workspace.role, "manage_widget_studio")}
    />
  );
}
