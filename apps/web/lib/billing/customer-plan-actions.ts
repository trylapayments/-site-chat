"use server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  estimateAdminPlanChange,
  executeAdminPlanChange,
} from "@/lib/billing/admin-plan-change";
import { BillingValidationError } from "@/lib/billing/stripe";
const schema = z
  .object({
    slug: z.string().min(1).max(200),
    planId: z.enum(["starter", "essential", "growth", "business"]),
    interval: z.enum(["month", "year"]),
    timing: z.enum(["now", "renewal"]),
  })
  .strict();
function sign(value: string) {
  const key = process.env.CHARGEBEE_API_KEY;
  if (!key) throw new Error("Billing unavailable");
  return createHmac("sha256", key)
    .update(`mill-customer-plan:${value}`)
    .digest("hex");
}
async function billingActor(slug: string) {
  const { workspace } = await requireInboxWorkspace(slug);
  if (!["owner", "admin"].includes(workspace.role))
    throw new Error("Billing access denied");
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Authentication required");
  return { workspace, user };
}
export async function customerPlanEstimate(input: unknown) {
  try {
    const data = schema.parse(input);
    const { workspace, user } = await billingActor(data.slug);
    const estimate = await estimateAdminPlanChange(
      workspace.workspace_id,
      data.planId,
      data.interval,
      data.timing,
    );
    const payload = Buffer.from(
      JSON.stringify({
        data,
        estimate,
        actor: user.id,
        expires: Date.now() + 5 * 60 * 1000,
      }),
    ).toString("base64url");
    return {
      success: true as const,
      estimate,
      token: `${payload}.${sign(payload)}`,
    };
  } catch (error) {
    return {
      success: false as const,
      message:
        error instanceof BillingValidationError
          ? error.message
          : "The estimate could not be loaded. No subscription was changed.",
    };
  }
}
export async function customerPlanConfirm(slug: string, token: string) {
  try {
    const { workspace, user } = await billingActor(slug);
    if (typeof token !== "string" || token.length > 10000)
      throw new Error("Invalid confirmation");
    const [payload, signature, ...extra] = token.split(".");
    if (!payload) throw new Error("Invalid confirmation");
    const expected = sign(payload);
    if (
      extra.length ||
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error("Invalid confirmation");
    const value = z
      .object({
        data: schema,
        estimate: z.object({
          version: z.number(),
          dueNow: z.number(),
          invoiceTotal: z.number(),
          credit: z.number(),
          nextTotal: z.number().nullable(),
          effectiveAt: z.number().nullable(),
        }),
        actor: z.string(),
        expires: z.number(),
      })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (value.actor !== user.id || value.expires < Date.now())
      throw new BillingValidationError(
        "This estimate expired. Request a fresh estimate.",
      );
    const { data, estimate } = value;
    if (data.slug !== slug) throw new Error("Invalid workspace");
    const fresh = await estimateAdminPlanChange(
      workspace.workspace_id,
      data.planId,
      data.interval,
      data.timing,
    );
    if (JSON.stringify(fresh) !== JSON.stringify(estimate))
      throw new BillingValidationError(
        "The calculation changed. Request a fresh estimate before confirming.",
      );
    const service = createServiceClient();
    const { data: audit, error } = await service
      .from("platform_audit_log")
      .insert({
        actor_id: user.id,
        workspace_id: workspace.workspace_id,
        action: "customer_billing_plan_change_requested",
        reason: "Customer self-service plan change",
        before_json: { estimate },
        after_json: {
          plan: data.planId,
          interval: data.interval,
          timing: data.timing,
        },
      })
      .select("id")
      .single();
    if (error) throw new Error("Audit unavailable");
    await executeAdminPlanChange(
      workspace.workspace_id,
      data.planId,
      data.interval,
      data.timing,
      estimate.version,
    );
    await service.from("platform_audit_log").insert({
      actor_id: user.id,
      workspace_id: workspace.workspace_id,
      action: "customer_billing_plan_change_completed",
      reason: "Customer self-service plan change",
      before_json: { request_id: audit.id },
      after_json: {
        plan: data.planId,
        interval: data.interval,
        timing: data.timing,
      },
    });
    revalidatePath(`/admin/customers/${workspace.workspace_id}`);
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/app/${slug}`, "layout");
    return {
      success: true,
      message:
        data.timing === "renewal"
          ? "Plan change scheduled for the next renewal."
          : "Paid plan changed. Billing records will refresh.",
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof BillingValidationError
          ? error.message
          : "The change could not be confirmed. Refresh Billing to check its status before trying again.",
    };
  }
}
