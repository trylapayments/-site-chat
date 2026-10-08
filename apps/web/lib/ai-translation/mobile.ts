import "server-only";
import { createClient } from "@supabase/supabase-js";
import { OpenAIProvider, TRANSLATION_LANGUAGES, type TranslationLanguage } from "@site-chat/ai";
import { z } from "zod";
import { env } from "@/lib/env.server";
import { authorizeMobile, type authenticateMobile } from "@/lib/mobile/access";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { chargebeeSite } from "@/lib/billing/chargebee";
import { millSubscriptionSchema } from "@/lib/billing/subscriptions";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveTranslationAllowance } from "./entitlement";
import { performTranslation, TranslationServiceError, type TranslationInput } from "./service";
import { translationStore } from "./store";

type Context = Awaited<ReturnType<typeof authenticateMobile>>;
const language = z
  .string()
  .refine((value) => Object.hasOwn(TRANSLATION_LANGUAGES, value), "Choose a supported language.")
  .transform((value) => value as TranslationLanguage);
const messageInput = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    targetLanguage: language,
    consent: z.literal(true),
  })
  .strict();
const draftInput = z
  .object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(4000),
    targetLanguage: language,
    consent: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict();
export function translationEnabled() {
  return process.env.MILL_AI_TRANSLATION_ENABLED === "1" && Boolean(process.env.OPENAI_API_KEY);
}
async function allowance(context: Context, workspaceId: string, reply = false) {
  await authorizeMobile(context, workspaceId, reply ? "send_messages" : "view_conversations");
  const { data: owner, error: ownerError } = await context.client
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle<{ user_id: string }>();
  if (ownerError || !owner)
    throw new TranslationServiceError(
      "BILLING_UNAVAILABLE",
      503,
      "Unable to verify the subscription owner.",
    );
  const ownerUserId = owner.user_id;
  const disabled = { enabled: false, ownerUserId, monthlyLimit: 0 };
  const access = await workspaceBillingAccess(workspaceId);
  const pilots = (process.env.MILL_AI_TRANSLATION_PILOT_ACCOUNT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (pilots.includes(ownerUserId)) {
    const monthlyLimit = resolveTranslationAllowance({
      workspaceEnabled: access.enabled,
      subscription: null,
      explicitlyApprovedPilot: true,
    });
    return { enabled: monthlyLimit > 0, ownerUserId, monthlyLimit };
  }
  const site = chargebeeSite();
  if (!site || !access.enabled) return disabled;
  const { data: anchor, error: anchorError } = await serviceClient()
    .from("ai_translation_accounts")
    .select("billing_workspace_id")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  if (anchorError)
    throw new TranslationServiceError(
      "BILLING_UNAVAILABLE",
      503,
      "Unable to verify translation access.",
    );
  const billingWorkspaceId = z.string().uuid().safeParse(anchor?.billing_workspace_id);
  if (!billingWorkspaceId.success) return disabled;
  // An ownership transfer cannot transfer an allowance or its billing anchor.
  const { data: billingOwner, error: billingOwnerError } = await createServiceClient()
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", billingWorkspaceId.data)
    .eq("user_id", ownerUserId)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();
  if (billingOwnerError || !billingOwner) return disabled;
  const billingAccess = await workspaceBillingAccess(billingWorkspaceId.data);
  if (!billingAccess.enabled) return disabled;
  const { data, error } = await createServiceClient()
    .from("billing_resource_snapshots")
    .select("payload")
    .eq("site", site)
    .eq("workspace_id", billingWorkspaceId.data)
    .eq("kind", "subscription")
    .eq("resource_id", `mill_${billingWorkspaceId.data}`)
    .maybeSingle();
  if (error)
    throw new TranslationServiceError(
      "BILLING_UNAVAILABLE",
      503,
      "Unable to verify translation access.",
    );
  const parsed = millSubscriptionSchema.safeParse(data?.payload);
  const sub = parsed.success ? parsed.data : null;
  const monthlyLimit = resolveTranslationAllowance({
    workspaceEnabled: access.enabled && billingAccess.enabled,
    explicitlyApprovedPilot: false,
    subscription:
      sub &&
      sub.id === `mill_${billingWorkspaceId.data}` &&
      sub.customer_id === `mill_${billingWorkspaceId.data}`
        ? {
            status: sub.status,
            termEnd: sub.current_term_end ?? 0,
            priceId: sub.subscription_items[0]?.item_price_id ?? "",
          }
        : null,
  });
  return { enabled: monthlyLimit > 0, ownerUserId, monthlyLimit };
}
function serviceClient() {
  // Dedicated server-only dynamic client for migration-backed tables. No key is
  // returned by this module or imported into the mobile bundle.
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function mobileTranslationCapabilities(context: Context, workspaceId: string) {
  const access = await allowance(context, workspaceId);
  const limit = access.monthlyLimit;
  if (!translationEnabled() || !limit) return { enabled: false, remaining: 0, monthlyLimit: 0 };
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const { data, error } = await serviceClient()
    .from("ai_translation_usage")
    .select("used")
    .eq("owner_user_id", access.ownerUserId)
    .eq("month_start", month)
    .maybeSingle();
  if (error)
    throw new TranslationServiceError(
      "TRANSLATION_UNAVAILABLE",
      503,
      "Translation is temporarily unavailable.",
    );
  const used = z
    .number()
    .int()
    .nonnegative()
    .parse(data?.used ?? 0);
  return { enabled: true, remaining: Math.max(0, limit - used), monthlyLimit: limit };
}
export async function mobileTranslate(
  context: Context,
  workspaceId: string,
  operation: "translateMessage" | "previewReplyTranslation",
  raw: unknown,
) {
  const input: TranslationInput =
    operation === "translateMessage"
      ? { ...messageInput.parse(raw), workspaceId, mode: "message" }
      : { ...draftInput.parse(raw), workspaceId, mode: "draft" };
  const access = await allowance(context, workspaceId, input.mode === "draft");
  const limit = access.monthlyLimit;
  if (!translationEnabled())
    throw new TranslationServiceError(
      "FEATURE_UNAVAILABLE",
      503,
      "AI translation is not available yet.",
    );
  if (!limit)
    throw new TranslationServiceError(
      "TRANSLATION_NOT_INCLUDED",
      403,
      "AI translation is not included in your subscription.",
    );
  const store = translationStore(serviceClient());
  return performTranslation(
    {
      ...store,
      enabled: true,
      provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o-mini" }),
      authorize: async (userId, p) => {
        if (userId !== context.user.id)
          throw new TranslationServiceError("FORBIDDEN", 403, "Translation access denied.");
        return allowance(context, p.workspaceId, p.mode === "draft");
      },
      resolveSource: async (_userId, p) => {
        // Operator client keeps conversation/message RLS and auth.uid() intact.
        const { data: conversation, error: conversationError } = await context.client
          .from("conversations")
          .select("id")
          .eq("workspace_id", p.workspaceId)
          .eq("id", p.conversationId)
          .maybeSingle();
        if (conversationError || !conversation)
          throw new TranslationServiceError("FORBIDDEN", 403, "Conversation access denied.");
        if (p.mode === "draft") return p.text;
        const { data, error } = await context.client
          .from("messages")
          .select("body,is_internal,sender_type")
          .eq("workspace_id", p.workspaceId)
          .eq("conversation_id", p.conversationId)
          .eq("id", p.messageId)
          .maybeSingle<Record<string, unknown>>();
        const message = z
          .object({
            body: z.string(),
            is_internal: z.boolean(),
            sender_type: z.enum(["agent", "visitor", "system"]),
          })
          .safeParse(data);
        if (
          error ||
          !message.success ||
          message.data.is_internal ||
          message.data.sender_type === "system"
        )
          throw new TranslationServiceError(
            "FORBIDDEN",
            403,
            "Message is unavailable for translation.",
          );
        return message.data.body;
      },
    },
    context.user.id,
    input,
  );
}
