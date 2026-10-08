"use server";
import { revalidatePath } from "next/cache";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { companyProfileSchema, type CompanyProfile } from "./schema";
export async function saveCompanyAction(slug: string, input: CompanyProfile) {
  const { workspace } = await requireInboxWorkspace(slug);
  if (!["owner", "admin"].includes(workspace.role))
    return {
      success: false,
      message: "Only owners and administrators can change company details.",
    };
  const parsed = companyProfileSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check your company details.",
    };
  const { error } = await callPublicRpc(
    await createClient(),
    "update_workspace_company",
    { p_workspace_id: workspace.workspace_id, p_profile: parsed.data },
  );
  if (error)
    return {
      success: false,
      message: "Company details could not be saved. Please try again.",
    };
  revalidatePath(`/app/${slug}`, "layout");
  return { success: true, message: "Company details saved." };
}

export async function deleteCompanyAction(slug: string, confirmation: string) {
 const {workspace}=await requireInboxWorkspace(slug);
 try {
  const {deleteCompany}=await import("./inboxes");
  await deleteCompany(await createClient(),workspace.workspace_id,{confirmation});
  revalidatePath("/app","layout");
  return {success:true,message:"Company deleted. Your login account is unchanged."};
 } catch(error) { return {success:false,message:error instanceof Error ? error.message : "Unable to delete company. Cancel any subscription in Billing first."}; }
}
