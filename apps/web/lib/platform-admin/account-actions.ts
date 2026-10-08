"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdministrator } from "./guard";
import type { AccountDatabase } from "./account-database";
const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string(),
  personal: z.boolean(),
});
const accountsSchema = z.object({
  count: z.number(),
  users: z.array(
    z.object({
      id: z.string().uuid(),
      email: z.string().nullable(),
      createdAt: z.string(),
      lastSignIn: z.string().nullable(),
      confirmed: z.boolean(),
      workspaces: z.array(workspaceSchema),
    }),
  ),
});
export type PlatformAccount = z.infer<typeof accountsSchema>["users"][number];
function accountService() {
  return createClient<AccountDatabase>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function listPlatformAccounts(query: string, page: number) {
  const { user, role } = await requirePlatformAdministrator();
  if (role !== "owner")
    throw new Error("Only Mill owners can manage accounts.");
  const { data, error } = await accountService().rpc(
    "platform_admin_list_accounts",
    {
      p_actor_id: user.id,
      p_query: query.slice(0, 100),
      p_page: Math.max(1, Math.min(10000, Math.floor(page))),
    },
  );
  if (error) throw new Error("Accounts could not be loaded.");
  return accountsSchema.parse(data);
}
const actionSchema = z
  .object({
    userId: z.string().uuid(),
    expectedEmail: z.string().trim().email().max(254),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
export async function deletePlatformAccount(input: {
  userId: string;
  expectedEmail: string;
  reason: string;
  confirmation: string;
}) {
  const { user, role } = await requirePlatformAdministrator();
  if (role !== "owner")
    return { success: false, message: "Only Mill owners can delete accounts." };
  const parsed = actionSchema
    .extend({ confirmation: z.string() })
    .safeParse(input);
  if (
    !parsed.success ||
    parsed.data.confirmation !== `DELETE ${parsed.data.expectedEmail}`
  )
    return {
      success: false,
      message: "Type DELETE followed by the account email to confirm.",
    };
  const { error } = await accountService().rpc(
    "platform_admin_delete_account",
    {
      p_actor_id: user.id,
      p_user_id: parsed.data.userId,
      p_expected_email: parsed.data.expectedEmail,
      p_reason: parsed.data.reason,
    },
  );
  if (error)
    return {
      success: false,
      message: error.message.includes("ownership")
        ? "Assign another owner to the shared company first."
        : error.message.includes("subscriptions")
          ? "Cancel connected subscriptions before deleting personal companies."
          : error.message.includes("Protected")
            ? "This Mill administrator account is protected."
            : error.message.includes("changed")
              ? "The account changed. Refresh before trying again."
              : "Account could not be deleted. No changes were committed.",
    };
  revalidatePath("/admin", "layout");
  return {
    success: true,
    message:
      "Account deleted. Its email is available for a new registration. Personal companies have been removed from the portal.",
  };
}
export async function changePlatformAccountEmail(input: {
  userId: string;
  expectedEmail: string;
  reason: string;
  email: string;
}) {
  const { user, role } = await requirePlatformAdministrator();
  if (role !== "owner")
    return {
      success: false,
      message: "Only Mill owners can change account email addresses.",
    };
  const parsed = actionSchema
    .extend({ email: z.string().trim().email().max(254) })
    .safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      message: "Provide valid email addresses and a reason.",
    };
  const p = parsed.data;
  const email = p.email.toLowerCase();
  if (p.userId === user.id)
    return {
      success: false,
      message: "Change your own email in your account settings.",
    };
  const service = createServiceClient();
  const { data: target, error: targetError } =
    await service.auth.admin.getUserById(p.userId);
  if (
    targetError ||
    target.user.email?.toLowerCase() !== p.expectedEmail.toLowerCase()
  )
    return {
      success: false,
      message: "The account changed. Refresh before trying again.",
    };
  if (email === p.expectedEmail.toLowerCase())
    return { success: false, message: "Enter a different email address." };
  const { data: audit, error: auditError } = await service
    .from("platform_audit_log")
    .insert({
      actor_id: user.id,
      action: "account_email_change",
      reason: p.reason,
      before_json: { user_id: p.userId, email: target.user.email },
      after_json: { email, status: "pending" },
    })
    .select("id")
    .single();
  if (auditError)
    return {
      success: false,
      message: "The change could not be recorded. Email was not changed.",
    };
  const { error } = await service.auth.admin.updateUserById(p.userId, {
    email,
    email_confirm: true,
  });
  const { error: finishError } = await service
    .from("platform_audit_log")
    .update({ after_json: { email, status: error ? "failed" : "completed" } })
    .eq("id", audit.id);
  if (error)
    return {
      success: false,
      message: ["email_exists", "user_already_exists"].includes(
        error.code ?? "",
      )
        ? "This email address is already in use. Choose another address."
        : "Email could not be changed.",
    };
  revalidatePath("/admin", "layout");
  return {
    success: true,
    message: finishError
      ? "Email changed. Audit completion needs review."
      : "Email changed and confirmed by Mill administration. The previous address is available for registration.",
  };
}
