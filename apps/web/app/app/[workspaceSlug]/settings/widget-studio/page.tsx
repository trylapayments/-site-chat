import { SitePicker } from "@/components/settings/widget-install/SitePicker";
import { workspaceSites } from "@/lib/widget-install/sites.server";
import { siteStudioState } from "@/lib/widget-studio/queries";
import { can, widgetStudioMessagesEn } from "@site-chat/shared";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { WidgetStudioManager } from "@/components/settings/widget-studio/WidgetStudioManager";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceSettingsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
import { effectiveWidgetEntitlements } from "@/lib/platform-admin/access";
import { fetchWidgetStudioState } from "@/lib/widget-studio/queries";

const messages = widgetStudioMessagesEn;

export default async function WidgetStudioSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ site?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWidgetStudioWorkspace(workspaceSlug);
  const supabase = await createClient();
  const { sites, selected } = await workspaceSites(
    workspace.workspace_id,
    (await searchParams).site,
  );
  const state = selected
    ? await siteStudioState(supabase, workspace.workspace_id, selected)
    : await fetchWidgetStudioState(supabase, workspace.workspace_id);

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

      <SitePicker
        slug={workspaceSlug}
        sites={sites}
        selected={selected}
        section="widget-studio"
      />
      <WidgetStudioManager
        key={selected ?? "default"}
        siteDomain={selected}
        workspaceSlug={workspaceSlug}
        initialState={state}
        features={[
          ...(await effectiveWidgetEntitlements(workspace.workspace_id))
            .features,
        ]}
        canManage={can(workspace.role, "manage_widget_studio")}
      />
    </div>
  );
}
