import { findMillPlan, type MillPlanId } from "./plans";

/** Matches public pricing. Common chat tools are included on every paid plan. */
export const MILL_CHAT_FEATURES = [
  "live_chat",
  "shared_inbox",
  "assignment",
  "private_notes",
  "saved_replies",
  "customer_history",
  "email_transcripts",
  "ratings",
  "widget_styling",
  "business_hours",
  "files",
  "voice_messages",
  "site_branding",
] as const;
export const MILL_AI_ALLOWANCES: Record<MillPlanId, number> = {
  starter: 0,
  essential: 100,
  growth: 500,
  business: 1000,
};
export function millPlanFeatures(planId: MillPlanId | null, enabled = true) {
  const plan = planId ? findMillPlan(planId) : null;
  return {
    chat: enabled,
    removeBranding: enabled && (plan?.removeBranding ?? false),
    ai: enabled && planId !== null && MILL_AI_ALLOWANCES[planId] > 0,
    monthlyAIConversations: enabled && planId ? MILL_AI_ALLOWANCES[planId] : 0,
    operators: plan?.operators ?? 0,
    sites: plan?.sites ?? 0,
  };
}
