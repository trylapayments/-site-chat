"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { companyProfileSchema } from "@/lib/company/schema";
import { findMillPlan } from "./plans";
import { manageMillSubscription, subscribeToMill } from "./subscriptions";
import { BillingSetupError, BillingValidationError } from "./stripe";

export async function subscriptionAction(slug: string, input: unknown) {
  const parsed = z
    .object({
      operation: z.enum(["subscribe", "cancel", "resume", "change"]),
      planId: z.enum(["starter", "essential", "growth", "business"]).optional(),
      interval: z.enum(["month", "year"]).default("month"),
      consent: z.literal(true),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      message: "Confirm the subscription details before continuing.",
    };
  try {
    const { workspace } = await requireInboxWorkspace(slug);
    if (!["owner", "admin"].includes(workspace.role))
      throw new Error("Billing access denied.");
    const { operation, planId, interval } = parsed.data;
    if (operation === "change")
      throw new BillingValidationError(
        "Review the price calculation before confirming a plan change.",
      );
    if (operation === "subscribe") {
      if (!planId || !findMillPlan(planId))
        throw new BillingValidationError("Choose a plan.");
      const { data, error } = await callPublicRpc(
        await createClient(),
        "get_workspace_company",
        { p_workspace_id: workspace.workspace_id },
      );
      if (error) throw new Error("Company unavailable.");
      const profile = companyProfileSchema.parse(data);
      await subscribeToMill({
        workspaceId: workspace.workspace_id,
        name: profile.legalName || profile.name,
        email: profile.email,
        planId,
        interval,
      });
    } else
      await manageMillSubscription(
        workspace.workspace_id,
        operation,
        planId,
        interval,
      );
    revalidatePath(`/app/${slug}`);
    revalidatePath(`/app/${slug}/billing`);
    return {
      success: true,
      message:
        operation === "subscribe"
          ? "Subscription started."
          : operation === "cancel"
            ? "Renewal cancelled. Your paid access continues until the end of the current period."
            : "Automatic renewal restored.",
    };
  } catch (error) {
    if (error instanceof BillingValidationError)
      return { success: false, message: error.message };
    if (error instanceof BillingSetupError)
      console.error("[Mill subscription]", {
        stage: error.stage,
        code: error.code,
      });
    return {
      success: false,
      message:
        "The subscription could not be updated. Refresh Billing to check its status before trying again.",
    };
  }
}
