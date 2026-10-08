/** Translation messages are distinct from legacy AI conversation credits. */
export const TRANSLATION_CATALOG_VERSION = "2026-10-v2";
const limits = { starter: 0, professional: 1000, business: 5000, enterprise: 15000 } as const;
export type TranslationPlan = keyof typeof limits;

// Proposed v2 IDs; publishing them in Chargebee is a separate billing release.
// Legacy IDs deliberately never acquire a new allowance by matching a name.
export function translationLimitFromPriceId(priceId: string): number {
  for (const [plan, limit] of Object.entries(limits)) {
    if ([`mill-v2-${plan}-usd-monthly`, `mill-v2-${plan}-usd-annual`].includes(priceId))
      return limit;
  }
  return 0;
}
export function resolveTranslationAllowance(input: {
  workspaceEnabled: boolean;
  subscription: { status: string; termEnd: number; priceId: string } | null;
  explicitlyApprovedPilot: boolean;
  nowMs?: number;
}): number {
  if (!input.workspaceEnabled) return 0;
  if (input.explicitlyApprovedPilot) return 1000;
  const sub = input.subscription;
  if (
    !sub ||
    !["active", "non_renewing"].includes(sub.status) ||
    sub.termEnd * 1000 <= (input.nowMs ?? Date.now())
  )
    return 0;
  return translationLimitFromPriceId(sub.priceId);
}
