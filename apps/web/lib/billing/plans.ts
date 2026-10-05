/** Approved monthly prices. This catalogue does not create subscriptions or grant access. */
export const MILL_PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthlyPriceCents: 2900,
    operators: 3,
    sites: 1,
    removeBranding: false,
    aiSuggestions: 0,
    description: "A polished live chat for small teams.",
  },
  {
    id: "essential",
    name: "Essential",
    monthlyPriceCents: 4900,
    operators: 5,
    sites: 2,
    removeBranding: true,
    aiSuggestions: 500,
    description: "Make every conversation feel like your brand.",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPriceCents: 8900,
    operators: 10,
    sites: 3,
    removeBranding: true,
    aiSuggestions: 2000,
    description: "More insight and assistance for a growing team.",
  },
  {
    id: "business",
    name: "Business",
    monthlyPriceCents: 19900,
    operators: 20,
    sites: 10,
    removeBranding: true,
    aiSuggestions: 5000,
    description: "Bring your customer service team together.",
  },
] as const;
export const MILL_PRICING = {
  currency: "USD",
  trialDays: 14,
  assist: {
    name: "Mill Assist",
    extraSuggestions: 1000,
    extraPriceCents: 1000,
    status: "planned",
  },
  agent: {
    name: "Mill AI Agent",
    monthlyPriceCents: 4900,
    includedResolutions: 100,
    extraResolutionPriceCents: 39,
    status: "planned",
  },
} as const;
export const formatMillPrice = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: MILL_PRICING.currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
