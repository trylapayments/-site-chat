import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  WIDGET_STUDIO_FEATURES,
  type WidgetStudioFeature,
} from "@site-chat/shared";
import { workspaceWidgetStudioEntitlements } from "@/lib/widget-studio/entitlements.server";
export async function effectiveWidgetEntitlements(workspaceId: string) {
  const { data, error } = await createServiceClient()
    .from("workspace_admin_controls")
    .select("access_mode,features,override_expires_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error("Workspace access could not be resolved.");
  const base = workspaceWidgetStudioEntitlements(workspaceId);
  if (!data) return base;
  const features = new Set<WidgetStudioFeature>(
    data.access_mode === "pilot" ? WIDGET_STUDIO_FEATURES : base.features,
  );
  const active =
    !data.override_expires_at ||
    Date.parse(data.override_expires_at) > Date.now();
  if (
    active &&
    data.features &&
    typeof data.features === "object" &&
    !Array.isArray(data.features)
  )
    for (const key of WIDGET_STUDIO_FEATURES) {
      if (data.features[key] === true) features.add(key);
      if (data.features[key] === false) features.delete(key);
    }
  return { features };
}
export async function workspaceWidgetAccessEnabled(workspaceId: string) {
  const { data, error } = await createServiceClient()
    .from("workspace_admin_controls")
    .select("access_mode,trial_ends_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error("Workspace access could not be resolved.");
  return (
    !data ||
    data.access_mode !== "trial" ||
    Boolean(data.trial_ends_at && Date.parse(data.trial_ends_at) > Date.now())
  );
}
