import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePlatformAdministrator } from "@/lib/platform-admin/guard";
import { createServiceClient } from "@/lib/supabase/service";
import { widgetAppearanceConfigSchema } from "@site-chat/shared";
import { PlatformLauncherEditor } from "@/components/platform-admin/PlatformLauncherEditor";
export default async function CustomerWidgetPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { role } = await requirePlatformAdministrator();
  if (role !== "owner") notFound();
  const { workspaceId } = await params;
  if (!z.string().uuid().safeParse(workspaceId).success) notFound();
  const service = createServiceClient();
  const [{ data: workspace }, { data: config }] = await Promise.all([
    service
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle(),
    service
      .from("widget_configs")
      .select("published_json,published_version")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);
  if (!workspace || !config) notFound();
  const appearance = widgetAppearanceConfigSchema.parse(config.published_json);
  return (
    <div className="space-y-6">
      <Link href={`/admin/customers/${workspaceId}`} className="text-primary">
        Back to customer
      </Link>
      <h1 className="text-2xl font-semibold">{workspace.name} · Widget</h1>
      <PlatformLauncherEditor
        workspaceId={workspaceId}
        version={config.published_version}
        hasCustomIcon={appearance.launcherIcon === "custom"}
      />
    </div>
  );
}
