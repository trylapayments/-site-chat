import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { chargebeeSite } from "./chargebee";
import { millSubscriptionSchema } from "./subscriptions";
import { billingDunning, billingAddOnDebts, invoiceAddOnIds } from "./dunning";
import { resolveBillingAccess } from "./access-policy";

export async function workspaceBillingAccess(workspaceId: string) {
  const service = createServiceClient();
  const site = chargebeeSite();
  const [workspace, controls, snapshot, invoices] = await Promise.all([
    service
      .from("workspaces")
      .select("status,created_at")
      .eq("id", workspaceId)
      .maybeSingle(),
    service
      .from("workspace_admin_controls")
      .select("access_mode,plan_id,trial_ends_at,override_expires_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    site
      ? service
          .from("billing_resource_snapshots")
          .select("payload")
          .eq("site", site)
          .eq("workspace_id", workspaceId)
          .eq("kind", "subscription")
          .eq("resource_id", `mill_${workspaceId}`)
          .maybeSingle()
      : { data: null, error: null },
    site
      ? service
          .from("billing_resource_snapshots")
          .select("payload")
          .eq("site", site)
          .eq("workspace_id", workspaceId)
          .eq("kind", "invoice")
          .in("payload->>status", ["payment_due", "not_paid"])
          .gt("payload->>amount_due", "0")
      : { data: [], error: null },
  ]);
  if (
    workspace.error ||
    controls.error ||
    snapshot.error ||
    invoices.error ||
    !workspace.data
  )
    throw new Error("Workspace access is unavailable.");
  const subscription = millSubscriptionSchema.safeParse(snapshot.data?.payload);
  const pilots = (process.env.MILL_FULL_FEATURE_WORKSPACE_IDS ?? "")
    .split(",")
    .map((id) => id.trim());
  const dunning = billingDunning(
    invoices.data.map((i) => i.payload),
    `mill_${workspaceId}`,
  );
  const addOnDebts = billingAddOnDebts(
    invoices.data.map((i) => i.payload),
    `mill_${workspaceId}`,
  );
  const disabledAddOns = [...new Set(addOnDebts.flatMap(invoiceAddOnIds))];
  const result = resolveBillingAccess({
    dunning,
    suspended: workspace.data.status !== "active",
    legacyPilot: pilots.includes(workspaceId),
    controls: controls.data,
    subscription: subscription.success
      ? {
          status: subscription.data.status,
          priceId: subscription.data.subscription_items[0]?.item_price_id ?? "",
          termEnd: subscription.data.current_term_end,
          trialEnd: subscription.data.trial_end,
        }
      : null,
  });
  const hasPaidSubscription =
    subscription.success &&
    ["active", "non_renewing"].includes(subscription.data.status) &&
    (subscription.data.current_term_end ?? 0) * 1000 > Date.now();
  // Existing pilots/workspaces keep their pre-launch behaviour until explicitly managed.
  // Every newly created workspace gets a finite trial via the DB trigger.
  if (
    !controls.data &&
    !snapshot.data &&
    result.source === "unsubscribed" &&
    workspace.data.status === "active"
  )
    return {
      ...result,
      enabled: true,
      source: "legacy" as const,
      hasPaidSubscription,
      dunning,
      addOnDebts,
      disabledAddOns,
    };
  return {
    ...result,
    hasPaidSubscription,
    dunning,
    addOnDebts,
    disabledAddOns,
  };
}
