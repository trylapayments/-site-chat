import { can, widgetStudioMessagesEn } from "@site-chat/shared";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { WidgetStudioManager } from "@/components/settings/widget-studio/WidgetStudioManager";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceSettingsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
import { fetchWidgetStudioState } from "@/lib/widget-studio/queries";

const messages = widgetStudioMessagesEn;

export default async function WidgetStudioSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWidgetStudioWorkspace(workspaceSlug);
  const supabase = await createClient();
  const state = await fetchWidgetStudioState(supabase, workspace.workspace_id);

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

      <WidgetStudioManager
        workspaceSlug={workspaceSlug}
        initialState={state}
        canManage={can(workspace.role, "manage_widget_studio")}
      />
    </div>
  );
}
