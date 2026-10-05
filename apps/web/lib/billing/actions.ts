"use server";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { companyProfileSchema } from "@/lib/company/schema";
import { ensureCustomer, createBillingPortal } from "./stripe";
export async function openBillingPortalAction(slug: string) {
  const { workspace } = await requireInboxWorkspace(slug);
  if (!["owner", "admin"].includes(workspace.role))
    return { message: "Only owners and administrators can manage billing." };
  let url: string;
  try {
    const { data, error } = await callPublicRpc(
      await createClient(),
      "get_workspace_company",
      { p_workspace_id: workspace.workspace_id },
    );
    if (error) throw new Error();
    const profile = companyProfileSchema.parse(data);
    const customer = await ensureCustomer(
      workspace.workspace_id,
      profile.legalName || profile.name,
      profile.email,
    );
    const origin = new URL(
      process.env.NEXT_PUBLIC_APP_URL || "https://app.mill.chat",
    ).origin;
    url = await createBillingPortal(
      customer,
      `${origin}/app/${encodeURIComponent(slug)}/billing`,
    );
  } catch {
    return {
      message: "Billing is temporarily unavailable. Please try again later.",
    };
  }
  redirect(url as Route);
}
