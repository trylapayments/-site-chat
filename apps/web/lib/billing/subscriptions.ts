import { sendSubscriptionEmailForChange } from "./subscription-email";
import "server-only";
import { z } from "zod";
import {
  chargebeeRequest,
  chargebeeSite,
  ensureChargebeeCustomer,
} from "./chargebee";
import {
  chargebeePlanPriceId,
  findMillPlan,
  type BillingInterval,
  millPlanPrice,
  type MillPlanId,
} from "./plans";
import { BillingValidationError } from "./stripe";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@site-chat/shared";

export const millSubscriptionSchema = z
  .object({
    id: z.string(),
    customer_id: z.string(),
    status: z.string(),
    resource_version: z.number(),
    current_term_end: z.number().optional(),
    trial_end: z.number().optional(),
    has_scheduled_changes: z.boolean().optional(),
    subscription_items: z.array(
      z.object({ item_price_id: z.string(), quantity: z.number().optional() }),
    ),
  })
  .passthrough();
export type MillSubscription = z.infer<typeof millSubscriptionSchema>;
export function checkoutEnabled() {
  return process.env.CHARGEBEE_CHECKOUT_ENABLED === "true";
}
export async function retrieveMillSubscription(workspaceId: string) {
  const id = `mill_${workspaceId}`;
  try {
    const raw = await chargebeeRequest(
      `subscriptions/${encodeURIComponent(id)}`,
    );
    const subscription = z
      .object({ subscription: millSubscriptionSchema })
      .parse(raw).subscription;
    if (subscription.id !== id || subscription.customer_id !== id)
      throw new Error("Subscription customer mismatch.");
    return subscription;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "404")
      return null;
    throw error;
  }
}
export async function storeMillSubscription(
  workspaceId: string,
  subscription: MillSubscription,
) {
  if (
    subscription.customer_id !== `mill_${workspaceId}` ||
    subscription.id !== `mill_${workspaceId}`
  )
    throw new Error("Subscription customer mismatch.");
  const { error } = await createServiceClient().rpc("apply_chargebee_event", {
    p_site: chargebeeSite() ?? "",
    p_event_id: `sync-${subscription.id}-${String(subscription.resource_version)}`,
    p_event_type: "mill_subscription_sync",
    p_resources: [
      {
        kind: "subscription",
        id: subscription.id,
        customer_id: subscription.customer_id,
        resource_version: subscription.resource_version,
        payload: subscription as Json,
      },
    ],
  });
  if (error) throw new Error("Subscription could not be synchronized.");
}
export async function validatePrice(
  planId: MillPlanId,
  interval: BillingInterval,
) {
  const plan = findMillPlan(planId);
  if (!plan) throw new BillingValidationError("Choose a Mill plan.");
  const raw = await chargebeeRequest(
    `item_prices/${chargebeePlanPriceId(plan.id, interval)}`,
  );
  const { item_price: price } = z
    .object({
      item_price: z.object({
        id: z.string(),
        price: z.number(),
        currency_code: z.string(),
        period: z.number(),
        period_unit: z.string(),
        status: z.string(),
      }),
    })
    .parse(raw);
  if (
    price.id !== chargebeePlanPriceId(plan.id, interval) ||
    price.price !== millPlanPrice(plan.id, interval) ||
    price.currency_code !== "USD" ||
    price.period !== 1 ||
    price.period_unit !== interval ||
    price.status !== "active"
  )
    throw new BillingValidationError(
      "This plan is temporarily unavailable. No payment was started.",
    );
  return plan;
}
export async function subscribeToMill(input: {
  workspaceId: string;
  name: string;
  email: string;
  planId: MillPlanId;
  interval: BillingInterval;
}) {
  if (!checkoutEnabled())
    throw new BillingValidationError("Subscriptions are not enabled yet.");
  const interval = input.interval;
  const plan = await validatePrice(input.planId, interval);
  const customer = await ensureChargebeeCustomer(
    input.workspaceId,
    input.name,
    input.email,
  );
  const current = await retrieveMillSubscription(input.workspaceId);
  if (current)
    throw new BillingValidationError(
      "This workspace already has a subscription. Manage it below.",
    );
  const raw = await chargebeeRequest(`customers/${customer}`);
  const paymentSource = z
    .object({
      customer: z.object({ primary_payment_source_id: z.string().optional() }),
    })
    .parse(raw).customer.primary_payment_source_id;
  if (!paymentSource)
    throw new BillingValidationError("Save a payment card before subscribing.");
  const params = new URLSearchParams({
    id: customer,
    "subscription_items[item_price_id][0]": chargebeePlanPriceId(
      plan.id,
      interval,
    ),
    "subscription_items[quantity][0]": "1",
    trial_end: "0",
    auto_collection: "on",
    payment_source_id: paymentSource,
    "statement_descriptor[descriptor]": "CHAT",
  });
  const created = await chargebeeRequest(
    `customers/${customer}/subscription_for_items`,
    params,
    `mill-subscribe-${customer}`,
  );
  const { subscription, invoice } = z
    .object({
      subscription: millSubscriptionSchema,
      invoice: z.unknown().optional(),
    })
    .parse(created);
  await storeMillSubscription(input.workspaceId, subscription);
  try {
    await sendSubscriptionEmailForChange(
      subscription,
      "subscription_created",
      invoice,
    );
  } catch {
    console.error("[Mill billing] welcome email requires retry");
  }
  return subscription;
}
export async function manageMillSubscription(
  workspaceId: string,
  operation: "cancel" | "resume" | "change",
  planId?: MillPlanId,
  interval: BillingInterval = "month",
) {
  if (!checkoutEnabled())
    throw new BillingValidationError(
      "Subscription changes are not enabled yet.",
    );
  const current = await retrieveMillSubscription(workspaceId);
  if (!current) throw new BillingValidationError("No subscription was found.");
  const params = new URLSearchParams();
  let path: string;
  if (operation === "cancel") {
    if (!["active", "in_trial"].includes(current.status))
      throw new BillingValidationError(
        "This subscription cannot be cancelled again.",
      );
    path = "cancel_for_items";
    params.set("end_of_term", "true");
  } else if (operation === "resume") {
    if (current.status !== "non_renewing")
      throw new BillingValidationError(
        "Only a scheduled cancellation can be undone here.",
      );
    path = "remove_scheduled_cancellation";
  } else {
    if (!planId || !["active", "non_renewing"].includes(current.status))
      throw new BillingValidationError(
        "Choose a plan for an active subscription.",
      );
    const plan = await validatePrice(planId, interval);
    if (current.status === "non_renewing")
      throw new BillingValidationError("Resume renewal before changing plans.");
    if (
      current.subscription_items[0]?.item_price_id ===
      chargebeePlanPriceId(plan.id, interval)
    )
      throw new BillingValidationError("You are already on this plan.");
    path = "update_for_items";
    params.set(
      "subscription_items[item_price_id][0]",
      chargebeePlanPriceId(plan.id, interval),
    );
    params.set("subscription_items[quantity][0]", "1");
    params.set("end_of_term", "true");
    params.set("replace_items_list", "true");
  }
  const subscription = z
    .object({ subscription: millSubscriptionSchema })
    .parse(
      await chargebeeRequest(
        `subscriptions/${current.id}/${path}`,
        params,
        `mill-${operation}-${current.id}-${String(current.resource_version)}-${planId ?? ""}-${interval}`,
      ),
    ).subscription;
  await storeMillSubscription(workspaceId, subscription);
  return subscription;
}
