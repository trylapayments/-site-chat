"use server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdministrator } from "./guard";
import { platformChangeSchema, type PlatformChange } from "./schema";
import { z } from "zod";
export async function applyPlatformChange(input: PlatformChange) {
  const { user, role } = await requirePlatformAdministrator();
  const parsed = platformChangeSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      message: "Check the fields and provide a reason.",
    };
  const { workspaceId, version, reason, change } = parsed.data;
  if (
    role !== "owner" &&
    !(role === "support" && ["note", "trial"].includes(change.action))
  )
    return {
      success: false,
      message: "Your platform role does not allow this action.",
    };
  const { error } = await createServiceClient().rpc("platform_admin_apply", {
    p_actor_id: user.id,
    p_workspace_id: workspaceId,
    p_action: change.action,
    p_payload: change.payload,
    p_reason: reason,
    p_expected_version: version,
  });
  if (error) {
    return {
      success: false,
      message:
        error.code === "40001"
          ? "This workspace changed. Refresh and try again."
          : error.message.includes("last active owner")
            ? "The last active owner cannot be removed."
            : error.message.includes("Connected billing trial")
              ? "This workspace has connected billing. Manage its trial through the subscription."
              : error.message.includes("Pilot access")
                ? "Change pilot access explicitly before granting a trial."
                : "The change could not be saved. Refresh and check the fields.",
    };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/customers/${workspaceId}`);
  return {
    success: true,
    message: "Saved. The change has been recorded in the audit log.",
  };
}
export async function setPlatformAdministratorAction(input: {
  email: string;
  role: string;
  enabled: boolean;
  reason: string;
}) {
  const { user, role } = await requirePlatformAdministrator();
  if (role !== "owner")
    return {
      success: false,
      message: "Only platform owners can change platform permissions.",
    };
  const parsed = z
    .object({
      email: z.string().trim().email().max(254),
      role: z.enum(["owner", "support", "finance", "viewer"]),
      enabled: z.boolean(),
      reason: z.string().trim().min(3).max(2000),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { success: false, message: "Check the email, role and reason." };
  const service = createServiceClient();
  let targetId: string | null = null;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error)
      return { success: false, message: "Accounts could not be searched." };
    const target = data.users.find(
      (u) => u.email?.toLowerCase() === parsed.data.email.toLowerCase(),
    );
    if (target) {
      targetId = target.id;
      break;
    }
    if (data.users.length < 100) break;
  }
  if (!targetId)
    return {
      success: false,
      message: "No existing confirmed Mill account was found.",
    };
  const { error } = await service.rpc("platform_admin_set_administrator", {
    p_actor_id: user.id,
    p_user_id: targetId,
    p_role: parsed.data.role,
    p_enabled: parsed.data.enabled,
    p_reason: parsed.data.reason,
  });
  if (error)
    return {
      success: false,
      message: error.message.includes("last platform owner")
        ? "The last platform owner cannot be removed."
        : "Permissions could not be saved. A confirmed Mill account is required.",
    };
  revalidatePath("/admin/team");
  return {
    success: true,
    message: "Platform permissions saved and recorded in the audit log.",
  };
}
