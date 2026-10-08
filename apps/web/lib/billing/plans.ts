/** Approved monthly prices. This catalogue does not create subscriptions or grant access. */
export const MILL_PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthlyPriceCents: 2900,
    operators: 3,
    sites: 1,
    removeBranding: false,
    description: "A polished live chat for small teams.",
  },
  {
    id: "essential",
    name: "Essential",
    monthlyPriceCents: 4900,
    operators: 5,
    sites: 2,
    removeBranding: true,
    description: "Make every conversation feel like your brand.",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPriceCents: 8900,
    operators: 10,
    sites: 3,
    removeBranding: true,
    description: "More insight and assistance for a growing team.",
  },
  {
    id: "business",
    name: "Business",
    monthlyPriceCents: 19900,
    operators: 20,
    sites: 10,
    removeBranding: true,
    description: "Bring your customer service team together.",
  },
] as const;
export const MILL_PRICING = {
  currency: "USD",
  trialDays: 14,
} as const;
export const formatMillPrice = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: MILL_PRICING.currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export type MillPlanId = (typeof MILL_PLANS)[number]["id"];
export function findMillPlan(id: string) {
  return MILL_PLANS.find((plan) => plan.id === id) ?? null;
}
export type BillingInterval = "month" | "year";
export function chargebeePlanPriceId(
  id: MillPlanId,
  interval: BillingInterval = "month",
) {
  return `mill-${id}-usd-${interval === "year" ? "annual" : "monthly"}`;
}
export function millPlanPrice(id: MillPlanId, interval: BillingInterval) {
  const plan = findMillPlan(id);
  return plan ? plan.monthlyPriceCents * (interval === "year" ? 10 : 1) : null;
}
export function planFromPriceId(priceId: string) {
  return (
    MILL_PLANS.find((p) =>
      [chargebeePlanPriceId(p.id), chargebeePlanPriceId(p.id, "year")].includes(
        priceId,
      ),
    ) ?? null
  );
}

/** Downgrades and annual-to-monthly switches take effect at renewal. */
export function paidPlanChangeTiming(
  currentId: MillPlanId,
  currentInterval: BillingInterval,
  nextId: MillPlanId,
  nextInterval: BillingInterval,
): "now" | "renewal" {
  const current = findMillPlan(currentId);
  const next = findMillPlan(nextId);
  if (!current || !next) throw new Error("Unknown Mill plan");
  if (next.monthlyPriceCents > current.monthlyPriceCents) return "now";
  if (next.monthlyPriceCents < current.monthlyPriceCents) return "renewal";
  return currentInterval === "year" && nextInterval === "month"
    ? "renewal"
    : "now";
}
