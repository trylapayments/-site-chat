import { workspaceCapacity } from "@/lib/billing/capacity";
import { can, widgetPublicKeySchema } from "@site-chat/shared";
import { WidgetInstallManager } from "@/components/settings/widget-install/WidgetInstallManager";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
import { buildInstallSnippet } from "@/lib/widget-install/domain";

export default async function InstallPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWidgetStudioWorkspace(workspaceSlug);
  const client = await createClient();
  const [key, domains] = await Promise.all([
    client
      .from("workspaces")
      .select("widget_public_key")
      .eq("id", workspace.workspace_id)
      .single(),
    client
      .from("allowed_domains")
      .select("id,domain,verified")
      .eq("workspace_id", workspace.workspace_id)
      .order("domain"),
  ]);
  if (key.error || domains.error)
    throw new Error("Could not load widget installation settings.");
  const capacity = await workspaceCapacity(workspace.workspace_id);
  return (
    <WidgetInstallManager
      slug={workspaceSlug}
      siteLimit={capacity.sites}
      snippet={buildInstallSnippet(
        clientEnv.NEXT_PUBLIC_APP_URL,
        widgetPublicKeySchema.parse(
          (key.data as unknown as Record<string, unknown>).widget_public_key,
        ),
      )}
      initialDomains={domains.data}
      canManage={can(workspace.role, "manage_widget_studio")}
    />
  );
}
