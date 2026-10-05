/** Approved monthly prices. This catalogue does not create subscriptions or grant access. */
export const MILL_PLANS = [
  {
    id: "starter",
    aiConversations: 0,
    name: "Starter",
    monthlyPriceCents: 2900,
    operators: 3,
    sites: 1,
    removeBranding: false,
    description: "A polished live chat for small teams.",
  },
  {
    id: "essential",
    aiConversations: 100,
    name: "Essential",
    monthlyPriceCents: 4900,
    operators: 5,
    sites: 2,
    removeBranding: true,
    description: "Make every conversation feel like your brand.",
  },
  {
    id: "growth",
    aiConversations: 500,
    name: "Growth",
    monthlyPriceCents: 8900,
    operators: 10,
    sites: 3,
    removeBranding: true,
    description: "More insight and assistance for a growing team.",
  },
  {
    id: "business",
    aiConversations: 1000,
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
