import { findMillPlan, planFromPriceId, type MillPlanId } from "./plans";

export type AccessInput = {
  suspended: boolean;
  legacyPilot: boolean;
  controls: {
    access_mode: string;
    plan_id?: string | null;
    trial_ends_at: string | null;
    override_expires_at: string | null;
  } | null;
  dunning?: {
    deadline: number;
    expired: boolean;
    initialPayment: boolean;
  } | null;
  subscription: {
    status: string;
    priceId: string;
    termEnd?: number;
    trialEnd?: number;
  } | null;
};

/** Mill grants outrank provider state. Suspension always wins. */
export function resolveBillingAccess(
  input: AccessInput,
  now = Date.now(),
): {
  enabled: boolean;
  planId: MillPlanId | null;
  source:
    | "suspended"
    | "pilot"
    | "complimentary"
    | "trial"
    | "subscription"
    | "grace"
    | "payment_overdue"
    | "unsubscribed";
  expiresAt: string | null;
} {
  const disabled = { enabled: false, planId: null, expiresAt: null } as const;
  if (input.suspended) return { ...disabled, source: "suspended" };
  const c = input.controls;
  const overrideActive =
    !c?.override_expires_at || Date.parse(c.override_expires_at) > now;
  if (
    (c?.access_mode === "pilot" && overrideActive) ||
    (input.legacyPilot && !c)
  )
    return {
      enabled: true,
      planId: "business",
      source: "pilot",
      expiresAt: c?.override_expires_at ?? null,
    };
  if (c?.plan_id && overrideActive && findMillPlan(c.plan_id))
    return {
      enabled: true,
      planId: c.plan_id as MillPlanId,
      source: "complimentary",
      expiresAt: c.override_expires_at,
    };
  if (
    c?.access_mode === "trial" &&
    c.trial_ends_at &&
    Date.parse(c.trial_ends_at) > now
  )
    return {
      enabled: true,
      planId: "business",
      source: "trial",
      expiresAt: c.trial_ends_at,
    };
  const s = input.subscription;
  const plan = s ? planFromPriceId(s.priceId) : null;
  if (
    input.dunning &&
    s &&
    plan &&
    ["active", "non_renewing"].includes(s.status)
  ) {
    if (input.dunning.expired || input.dunning.initialPayment)
      return { ...disabled, source: "payment_overdue" };
    return {
      enabled: true,
      planId: plan.id,
      source: "grace",
      expiresAt: new Date(input.dunning.deadline).toISOString(),
    };
  }
  const expires = s?.status === "in_trial" ? s.trialEnd : s?.termEnd;
  if (
    s &&
    plan &&
    ["active", "non_renewing", "in_trial"].includes(s.status) &&
    expires &&
    expires * 1000 > now
  )
    return {
      enabled: true,
      planId: plan.id,
      source: "subscription",
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  return { ...disabled, source: "unsubscribed" };
}
