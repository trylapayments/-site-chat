import { sendSubscriptionEmailForChange } from "./subscription-email";
import "server-only";
import { z } from "zod";
import { chargebeeRequest } from "./chargebee";
import {
  chargebeePlanPriceId,
  planFromPriceId,
  paidPlanChangeTiming,
  type BillingInterval,
  type MillPlanId,
} from "./plans";
import {
  checkoutEnabled,
  retrieveMillSubscription,
  storeMillSubscription,
  validatePrice,
} from "./subscriptions";
import { BillingValidationError } from "./stripe";
export function planChangeParams(
  planId: MillPlanId,
  interval: BillingInterval,
  timing: "now" | "renewal",
) {
  return new URLSearchParams({
    "subscription_items[item_price_id][0]": chargebeePlanPriceId(
      planId,
      interval,
    ),
    "subscription_items[quantity][0]": "1",
    replace_items_list: "true",
    end_of_term: String(timing === "renewal"),
    prorate: "true",
    invoice_immediately: "true",
  });
}
const invoice = z
  .object({
    amount_due: z.number().int().nonnegative(),
    total: z.number().int(),
    currency_code: z.literal("USD"),
  })
  .passthrough();
export async function estimateAdminPlanChange(
  workspaceId: string,
  planId: MillPlanId,
  interval: BillingInterval,
  timing: "now" | "renewal",
) {
  if (!checkoutEnabled())
    throw new BillingValidationError("Paid plan changes are not enabled.");
  const current = await retrieveMillSubscription(workspaceId);
  if (!current || current.status !== "active")
    throw new BillingValidationError(
      "An active renewing subscription is required. Restore renewal before changing plans.",
    );
  const currentPrice = current.subscription_items[0]?.item_price_id ?? "";
  const currentPlan = planFromPriceId(currentPrice);
  if (!currentPlan)
    throw new BillingValidationError(
      "This subscription's plan must be reviewed before changing it.",
    );
  const expectedTiming = paidPlanChangeTiming(
    currentPlan.id,
    currentPrice.endsWith("annual") ? "year" : "month",
    planId,
    interval,
  );
  if (timing !== expectedTiming)
    throw new BillingValidationError(
      "Upgrades apply immediately. Downgrades apply at renewal. Refresh Billing and review the change.",
    );
  await validatePrice(planId, interval);
  if (
    current.subscription_items[0]?.item_price_id ===
    chargebeePlanPriceId(planId, interval)
  )
    throw new BillingValidationError(
      "Choose a different plan or billing interval.",
    );
  const params = planChangeParams(planId, interval, timing);
  params.set("subscription[id]", current.id);
  const parsed = z
    .object({
      estimate: z.object({
        invoice_estimate: invoice.optional(),
        next_invoice_estimate: invoice.optional(),
        credit_note_estimates: z
          .array(
            z.object({
              total: z.number().int(),
              currency_code: z.literal("USD"),
            }),
          )
          .optional(),
      }),
    })
    .parse(
      await chargebeeRequest("estimates/update_subscription_for_items", params),
    );
  return {
    version: current.resource_version,
    dueNow: parsed.estimate.invoice_estimate?.amount_due ?? 0,
    invoiceTotal: parsed.estimate.invoice_estimate?.total ?? 0,
    credit:
      parsed.estimate.credit_note_estimates?.reduce((n, c) => n + c.total, 0) ??
      0,
    nextTotal: parsed.estimate.next_invoice_estimate?.total ?? null,
    effectiveAt:
      timing === "renewal" ? (current.current_term_end ?? null) : null,
  };
}
export async function executeAdminPlanChange(
  workspaceId: string,
  planId: MillPlanId,
  interval: BillingInterval,
  timing: "now" | "renewal",
  version: number,
) {
  const current = await retrieveMillSubscription(workspaceId);
  if (
    !current ||
    current.status !== "active" ||
    current.resource_version !== version
  )
    throw new BillingValidationError(
      "The subscription changed. Request a fresh estimate.",
    );
  const raw = await chargebeeRequest(
    `subscriptions/${current.id}/update_for_items`,
    planChangeParams(planId, interval, timing),
    `mill-admin-change-${current.id}-${String(version)}-${planId}-${interval}-${timing}`,
  );
  const { millSubscriptionSchema } = await import("./subscriptions");
  const subscription = z
    .object({ subscription: millSubscriptionSchema })
    .parse(raw).subscription;
  await storeMillSubscription(workspaceId, subscription);
  try {
    await sendSubscriptionEmailForChange(
      subscription,
      timing === "renewal"
        ? "subscription_changes_scheduled"
        : "subscription_changed",
      z.object({ invoice: z.unknown().optional() }).parse(raw).invoice,
    );
  } catch {
    console.error("[Mill billing] plan email requires retry");
  }
  return subscription;
}
