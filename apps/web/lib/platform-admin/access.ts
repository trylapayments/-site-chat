import "server-only";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { findMillPlan } from "@/lib/billing/plans";
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
  const access = await workspaceBillingAccess(workspaceId);
  const base = workspaceWidgetStudioEntitlements(workspaceId);
  const plan = access.planId ? findMillPlan(access.planId) : null;
  const planFeatures = !access.enabled
    ? []
    : plan
      ? WIDGET_STUDIO_FEATURES.filter(
          (f) =>
            f !== "custom_launcher_icon" &&
            f !== "custom_domain" &&
            (f !== "hide_powered_by" || plan.removeBranding),
        )
      : base.features;
  if (!data)
    return {
      features: new Set<WidgetStudioFeature>(
        [...planFeatures].filter((f) => f !== "custom_launcher_icon"),
      ),
    };
  const features = new Set<WidgetStudioFeature>(planFeatures);
  const active =
    !data.override_expires_at ||
    Date.parse(data.override_expires_at) > Date.now();
  if (
    access.enabled &&
    active &&
    data.features &&
    typeof data.features === "object" &&
    !Array.isArray(data.features)
  )
    for (const key of WIDGET_STUDIO_FEATURES) {
      if (key !== "custom_launcher_icon" && data.features[key] === true)
        features.add(key);
      if (data.features[key] === false) features.delete(key);
    }
  features.delete("custom_launcher_icon");
  return { features };
}
export async function workspaceWidgetAccessEnabled(workspaceId: string) {
  return (await workspaceBillingAccess(workspaceId)).enabled;
}
