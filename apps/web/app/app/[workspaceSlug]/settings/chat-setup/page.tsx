import { SitePicker } from "@/components/settings/widget-install/SitePicker";
import { workspaceSites } from "@/lib/widget-install/sites.server";
import { siteStudioState } from "@/lib/widget-studio/queries";
import { effectiveWidgetEntitlements } from "@/lib/platform-admin/access";
import { fetchWidgetStudioState } from "@/lib/widget-studio/queries";
import { createClient } from "@/lib/supabase/server";
import { resolveShowPoweredBy, can } from "@site-chat/shared";
import { ChatSetupEditor } from "@/components/settings/chat-setup/ChatSetupEditor";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
export default async function ChatSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ site?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWidgetStudioWorkspace(workspaceSlug);
  const { sites, selected } = await workspaceSites(
    workspace.workspace_id,
    (await searchParams).site,
  );
  const [state, appearance] = await Promise.all([
    fetchChatSetup(workspace.workspace_id, selected),
    selected
      ? siteStudioState(await createClient(), workspace.workspace_id, selected)
      : fetchWidgetStudioState(await createClient(), workspace.workspace_id),
  ]);
  return (
    <div className="space-y-6">
      <SitePicker
        slug={workspaceSlug}
        sites={sites}
        selected={selected}
        section="chat-setup"
      />
      <ChatSetupEditor
        key={selected ?? "default"}
        siteDomain={selected}
        slug={workspaceSlug}
        initial={state}
        workspaceName={workspace.name}
        showPoweredBy={resolveShowPoweredBy({
          configured: appearance.published.showPoweredBy,
          entitlements: await effectiveWidgetEntitlements(
            workspace.workspace_id,
          ),
        })}
        canManage={can(workspace.role, "manage_widget_studio")}
      />
    </div>
  );
}
