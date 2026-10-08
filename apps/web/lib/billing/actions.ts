"use server";
import { revalidatePath } from "next/cache";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { companyProfileSchema } from "@/lib/company/schema";
import {
  ensureCustomer,
  setDefaultCard,
  removeCard,
  saveBillingDetails,
} from "./provider";
import {
  createCardSetup,
  completeCardSetup,
  BillingSetupError,
  BillingValidationError,
} from "./stripe";
import { usesChargebee } from "./provider";
import {
  startChargebeeCardSetup,
  completeChargebeeCardSetup,
} from "./chargebee";
import { billingDetailsSchema, type BillingDetails } from "./schema";
async function billingContext(slug: string) {
  const { workspace } = await requireInboxWorkspace(slug);
  if (!["owner", "admin"].includes(workspace.role))
    throw new Error("Billing access denied.");
  const { data, error } = await callPublicRpc(
    await createClient(),
    "get_workspace_company",
    { p_workspace_id: workspace.workspace_id },
  );
  if (error) throw new Error("Company is unavailable.");
  const profile = companyProfileSchema.parse(data);
  const customer = await ensureCustomer(
    workspace.workspace_id,
    profile.legalName || profile.name,
    profile.email,
  );
  return { workspaceId: workspace.workspace_id, customer };
}
function failure(error: unknown) {
  if (error instanceof BillingValidationError)
    return { success: false as const, message: error.message };
  if (error instanceof BillingSetupError)
    console.error("[Mill billing]", { stage: error.stage, code: error.code });
  return {
    success: false as const,
    message: "Billing is temporarily unavailable. Please try again later.",
  };
}
export async function startCardSetupAction(slug: string) {
  try {
    if (usesChargebee())
      throw new BillingValidationError("Use the embedded Mill card form.");
    const { customer, workspaceId } = await billingContext(slug);
    return {
      success: true as const,
      clientSecret: await createCardSetup(customer, workspaceId),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function completeCardSetupAction(slug: string, setupId: string) {
  try {
    if (usesChargebee())
      throw new BillingValidationError("Use the embedded Mill card form.");
    const { customer, workspaceId } = await billingContext(slug);
    await completeCardSetup(customer, workspaceId, setupId);
    revalidatePath(`/app/${slug}/billing`);
    return { success: true as const, message: "Card saved." };
  } catch (error) {
    return failure(error);
  }
}
export async function updateDefaultCardAction(slug: string, methodId: string) {
  try {
    const { customer } = await billingContext(slug);
    await setDefaultCard(customer, methodId);
    revalidatePath(`/app/${slug}/billing`);
    return { success: true as const, message: "Default card updated." };
  } catch (error) {
    return failure(error);
  }
}
export async function removeCardAction(slug: string, methodId: string) {
  try {
    const { customer } = await billingContext(slug);
    await removeCard(customer, methodId);
    revalidatePath(`/app/${slug}/billing`);
    return { success: true as const, message: "Card removed." };
  } catch (error) {
    return failure(error);
  }
}
export async function saveBillingDetailsAction(
  slug: string,
  input: BillingDetails,
) {
  const parsed = billingDetailsSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false as const,
      message: "Check your billing name, email and country code.",
    };
  try {
    const { customer } = await billingContext(slug);
    await saveBillingDetails(customer, parsed.data);
    revalidatePath(`/app/${slug}/billing`);
    return { success: true as const, message: "Billing details saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function startChargebeeCardAction(slug: string) {
  try {
    const { customer, workspaceId } = await billingContext(slug);
    return {
      success: true as const,
      paymentIntent: await startChargebeeCardSetup(workspaceId, customer),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function completeChargebeeCardAction(
  slug: string,
  intentId: string,
) {
  try {
    const { customer, workspaceId } = await billingContext(slug);
    await completeChargebeeCardSetup(workspaceId, customer, intentId);
    revalidatePath(`/app/${slug}/billing`);
    return { success: true as const, message: "Card saved." };
  } catch (error) {
    return failure(error);
  }
}
