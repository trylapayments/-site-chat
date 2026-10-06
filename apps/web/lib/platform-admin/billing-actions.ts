"use server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdministrator } from "./guard";
import { createServiceClient } from "@/lib/supabase/service";
import {
  estimateAdminPlanChange,
  executeAdminPlanChange,
} from "@/lib/billing/admin-plan-change";
import { BillingValidationError } from "@/lib/billing/stripe";
const schema = z
  .object({
    workspaceId: z.string().uuid(),
    planId: z.enum(["starter", "essential", "growth", "business"]),
    interval: z.enum(["month", "year"]),
    timing: z.enum(["now", "renewal"]),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
function sign(value: string) {
  const key = process.env.CHARGEBEE_API_KEY;
  if (!key) throw new Error("Billing unavailable");
  return createHmac("sha256", key)
    .update(`mill-admin-plan:${value}`)
    .digest("hex");
}
export async function adminPlanEstimate(input: unknown) {
  try {
    const { user, role } = await requirePlatformAdministrator();
    if (!["owner", "finance"].includes(role))
      return {
        success: false as const,
        message: "Your role cannot change paid subscriptions.",
      };
    const data = schema.parse(input);
    const estimate = await estimateAdminPlanChange(
      data.workspaceId,
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
export async function adminPlanConfirm(token: string) {
  try {
    const { user, role } = await requirePlatformAdministrator();
    if (!["owner", "finance"].includes(role))
      return {
        success: false,
        message: "Your role cannot change paid subscriptions.",
      };
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
    const fresh = await estimateAdminPlanChange(
      data.workspaceId,
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
        workspace_id: data.workspaceId,
        action: "billing_plan_change_requested",
        reason: data.reason,
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
      data.workspaceId,
      data.planId,
      data.interval,
      data.timing,
      estimate.version,
    );
    await service.from("platform_audit_log").insert({
      actor_id: user.id,
      workspace_id: data.workspaceId,
      action: "billing_plan_change_completed",
      reason: data.reason,
      before_json: { request_id: audit.id },
      after_json: {
        plan: data.planId,
        interval: data.interval,
        timing: data.timing,
      },
    });
    revalidatePath(`/admin/customers/${data.workspaceId}`);
    revalidatePath("/admin/subscriptions");
    revalidatePath("/app", "layout");
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
