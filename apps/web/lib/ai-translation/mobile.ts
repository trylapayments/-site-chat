import "server-only";
import { can, type Database } from "@site-chat/shared";
import { createClient } from "@supabase/supabase-js";
import {
  OpenAIProvider,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
} from "@site-chat/ai";
import { z } from "zod";
import { env } from "@/lib/env.server";
import { type authenticateMobile } from "@/lib/mobile/access";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { chargebeeSite } from "@/lib/billing/chargebee";
import { millSubscriptionSchema } from "@/lib/billing/subscriptions";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveTranslationAllowance } from "./entitlement";
import {
  performTranslation,
  TranslationServiceError,
  type TranslationInput,
} from "./service";
import { translationStore, type TranslationDatabase } from "./store";

type Context = Awaited<ReturnType<typeof authenticateMobile>>;
const language = z
  .string()
  .refine(
    (value) => Object.hasOwn(TRANSLATION_LANGUAGES, value),
    "Choose a supported language.",
  )
  .transform((value) => value as TranslationLanguage);
const messageInput = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    targetLanguage: language,
    consent: z.literal(true),
    withSourceLanguage: z.boolean().optional(),
  })
  .strict();
const draftInput = z
  .object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(4000),
    targetLanguage: language,
    consent: z.literal(true),
    withSourceLanguage: z.boolean().optional(),
    requestId: z.string().uuid(),
  })
  .strict();
export function translationEnabled() {
  return (
    process.env.MILL_AI_TRANSLATION_ENABLED === "1" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}
async function allowance(context: Context, workspaceId: string, reply = false) {
  // Read this workspace's current membership/owner and billing in parallel.
  // No cached roles or cross-request access decisions; reservation rechecks ownership.
  const [membership, billing] = await Promise.all([
    context.client.from("workspace_members").select("id,user_id,role")
      .eq("workspace_id", workspaceId).eq("status", "active")
      .or(`user_id.eq.${context.user.id},role.eq.owner`)
      .overrideTypes<Array<Pick<Database["public"]["Tables"]["workspace_members"]["Row"], "id" | "user_id" | "role">>, { merge: false }>(),
    workspaceBillingAccess(workspaceId),
  ]);
  const member = membership.data?.find(row => row.user_id === context.user.id);
  if (membership.error || !member || !can(member.role, reply ? "send_messages" : "view_conversations"))
    throw new TranslationServiceError("FORBIDDEN", 403, "Workspace access denied.");
  if (!billing.enabled)
    throw new TranslationServiceError("FORBIDDEN", 403, "Workspace access is restricted.");
  const owners = membership.data.filter(row => row.role === "owner");
  const owner = owners.length === 1 ? owners[0] : undefined;
  if (!owner)
    throw new TranslationServiceError("BILLING_UNAVAILABLE", 503, "Unable to verify the subscription owner.");
  const ownerUserId = owner.user_id;
  const disabled = { enabled: false, ownerUserId, monthlyLimit: 0 };
  // Fresh billing access was checked alongside membership above.
  const access = { enabled: true };
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
  const { data: anchor, error: anchorError } = await translationServiceClient()
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
  const billingWorkspaceId = z
    .string()
    .uuid()
    .safeParse(anchor?.billing_workspace_id);
  if (!billingWorkspaceId.success) return disabled;
  // An ownership transfer cannot transfer an allowance or its billing anchor.
  const { data: billingOwner, error: billingOwnerError } =
    await createServiceClient()
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
    workspaceEnabled: true,
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
export function translationServiceClient() {
  // Dedicated server-only dynamic client for migration-backed tables. No key is
  // returned by this module or imported into the mobile bundle.
  return createClient<TranslationDatabase>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
export async function mobileTranslationCapabilities(
  context: Context,
  workspaceId: string,
) {
  const access = await allowance(context, workspaceId);
  const limit = access.monthlyLimit;
  if (!translationEnabled() || !limit)
    return { enabled: false, remaining: 0, monthlyLimit: 0 };
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const { data, error } = await translationServiceClient()
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
  return {
    enabled: true,
    remaining: Math.max(0, limit - used),
    monthlyLimit: limit,
  };
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!translationEnabled() || !apiKey)
    throw new TranslationServiceError(
      "FEATURE_UNAVAILABLE",
      503,
      "AI translation is not available yet.",
    );
  if (!limit)
    throw new TranslationServiceError(
      "TRANSLATION_NOT_INCLUDED",
      403,
      "AI translation is not included in this subscription.",
    );
  const store = translationStore(translationServiceClient());
  return performTranslation(
    {
      ...store,
      enabled: true,
      provider: new OpenAIProvider({ apiKey, model: input.withSourceLanguage ? "gpt-4.1-mini" : "gpt-4o-mini" }),
      authorize: (userId, p) => {
        if (userId !== context.user.id)
          throw new TranslationServiceError(
            "FORBIDDEN",
            403,
            "Translation access denied.",
          );
        if (p.workspaceId !== workspaceId || p.mode !== input.mode)
          throw new TranslationServiceError("FORBIDDEN", 403, "Translation access denied.");
        // Reuse only this request's verified membership/billing result. Every new
        // request, including a cache hit, still runs allowance above.
        return Promise.resolve(access);
      },
      resolveSource: async (_userId, p) => {
        // Operator client keeps conversation/message RLS and auth.uid() intact.
        const conversationRequest = context.client
            .from("conversations")
            .select("id")
            .eq("workspace_id", p.workspaceId)
            .eq("id", p.conversationId)
            .maybeSingle();
        const messageRequest = p.mode === "message" ? context.client
          .from("messages").select("body,is_internal,sender_type")
          .eq("workspace_id", p.workspaceId).eq("conversation_id", p.conversationId)
          .eq("id", p.messageId).maybeSingle<Record<string, unknown>>() : Promise.resolve(null);
        const [conversationResult, messageResult] = await Promise.all([conversationRequest, messageRequest]);
        const { data: conversation, error: conversationError } = conversationResult;
        const validConversation = z
          .object({ id: z.string().uuid() })
          .safeParse(conversation);
        if (conversationError || !validConversation.success)
          throw new TranslationServiceError(
            "FORBIDDEN",
            403,
            "Conversation access denied.",
          );
        if (p.mode === "draft") return p.text;
        if (!messageResult) throw new TranslationServiceError("FORBIDDEN", 403, "Message unavailable.");
        const { data, error } = messageResult;
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
