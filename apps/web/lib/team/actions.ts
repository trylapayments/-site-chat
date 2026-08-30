"use server";

import {
  createWorkspaceInvitationInputSchema,
  parseTeamErrorMessage,
  resolveRoleMutationRpc,
  revokeWorkspaceInvitationInputSchema,
  TeamError,
  teamMessagesEn,
  updateWorkspaceMemberRoleInputSchema,
  workspaceMemberIdInputSchema,
  type CreateWorkspaceInvitationResult,
  type ListWorkspaceTeamResult,
} from "@site-chat/shared/team";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import { requireTeamWorkspace } from "@/lib/team/guards";
import {
  createWorkspaceInvitation,
  deactivateWorkspaceMember,
  demoteWorkspaceOwner,
  fetchWorkspaceTeam,
  promoteWorkspaceMemberToOwner,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  updateWorkspaceMemberRole,
} from "@/lib/team/queries";

const messages = teamMessagesEn;

export type TeamActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string };

function mapTeamActionError<T>(
  error: unknown,
  fallback: string,
): TeamActionResult<T> {
  if (error instanceof CapabilityError) {
    return { success: false, message: error.message, code: "FORBIDDEN" };
  }
  if (error instanceof TeamError) {
    return { success: false, message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    const typed = parseTeamErrorMessage(error.message);
    if (typed) {
      return { success: false, message: typed.message, code: typed.code };
    }
  }
  return { success: false, message: fallback };
}

async function requireTeamContext(workspaceSlug: string) {
  const { workspace } = await requireTeamWorkspace(workspaceSlug);
  const supabase = await createClient();
  const { user } = await requireUser(supabase);
  return { workspace, supabase, user };
}

async function callerMemberId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

function revalidateTeamPath(workspaceSlug: string): void {
  revalidatePath(workspaceNavPath(workspaceSlug, "team"));
}

function inviteUrl(token: string): string {
  return new URL(`/invite/${token}`, clientEnv.NEXT_PUBLIC_APP_URL).toString();
}

export async function listWorkspaceTeamAction(
  workspaceSlug: string,
): Promise<TeamActionResult<ListWorkspaceTeamResult>> {
  try {
    const { workspace, supabase } = await requireTeamContext(workspaceSlug);
    requireCapability(workspace.role, "view_workspace_members");
    const data = await fetchWorkspaceTeam(supabase, workspace.workspace_id);
    return { success: true, data };
  } catch (error) {
    return mapTeamActionError(error, messages.loadError);
  }
}

export async function inviteWorkspaceMemberAction(
  workspaceSlug: string,
  input: unknown,
): Promise<
  TeamActionResult<CreateWorkspaceInvitationResult & { invite_url: string }>
> {
  try {
    const parsed = createWorkspaceInvitationInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message:
          parsed.error.issues[0]?.message ?? "Fix the highlighted fields.",
        code: "INVALID_EMAIL",
      };
    }

    const { workspace, supabase } = await requireTeamContext(workspaceSlug);
    requireCapability(workspace.role, "manage_workspace_members");

    const data = await createWorkspaceInvitation(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateTeamPath(workspaceSlug);
    return {
      success: true,
      data: { ...data, invite_url: inviteUrl(data.token) },
    };
  } catch (error) {
    return mapTeamActionError(error, "Unable to create the invitation.");
  }
}

export async function revokeWorkspaceInvitationAction(
  workspaceSlug: string,
  input: unknown,
): Promise<TeamActionResult> {
  try {
    const parsed = revokeWorkspaceInvitationInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invitation not found." };
    }

    const { workspace, supabase } = await requireTeamContext(workspaceSlug);
    requireCapability(workspace.role, "manage_workspace_members");

    const team = await fetchWorkspaceTeam(supabase, workspace.workspace_id);
    const invitation = team.invitations.find(
      (item) => item.invitation_id === parsed.data.invitationId,
    );
    if (!invitation) {
      throw new TeamError("INVITATION_NOT_FOUND", messages.revokeDescription);
    }

    await revokeWorkspaceInvitation(supabase, parsed.data);
    revalidateTeamPath(workspaceSlug);
    return { success: true, data: undefined };
  } catch (error) {
    return mapTeamActionError(error, "Unable to cancel this invitation.");
  }
}

export async function updateWorkspaceMemberRoleAction(
  workspaceSlug: string,
  input: unknown,
): Promise<TeamActionResult> {
  try {
    const parsed = updateWorkspaceMemberRoleInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "That role change is not allowed." };
    }

    const { workspace, supabase, user } =
      await requireTeamContext(workspaceSlug);
    requireCapability(workspace.role, "manage_workspace_members");

    const memberId = await callerMemberId(
      supabase,
      workspace.workspace_id,
      user?.id ?? "",
    );
    if (memberId && parsed.data.memberId === memberId) {
      return {
        success: false,
        message: messages.selfActionBlocked,
        code: "FORBIDDEN",
      };
    }

    const team = await fetchWorkspaceTeam(supabase, workspace.workspace_id);
    const target = team.members.find(
      (item) => item.member_id === parsed.data.memberId,
    );
    if (!target) {
      throw new TeamError(
        "MEMBER_NOT_FOUND",
        "Member not found in this workspace.",
      );
    }

    if (parsed.data.role === target.role) {
      return { success: true, data: undefined };
    }

    const rpc = resolveRoleMutationRpc({
      currentRole: target.role,
      nextRole: parsed.data.role,
    });

    if (rpc === "promote_workspace_member_to_owner") {
      await promoteWorkspaceMemberToOwner(supabase, {
        memberId: parsed.data.memberId,
      });
    } else if (rpc === "demote_workspace_owner") {
      if (parsed.data.role === "owner") {
        return { success: false, message: "That role change is not allowed." };
      }
      await demoteWorkspaceOwner(supabase, {
        memberId: parsed.data.memberId,
        role: parsed.data.role,
      });
    } else {
      if (parsed.data.role === "owner") {
        return { success: false, message: "That role change is not allowed." };
      }
      await updateWorkspaceMemberRole(supabase, {
        memberId: parsed.data.memberId,
        role: parsed.data.role,
      });
    }

    revalidateTeamPath(workspaceSlug);
    return { success: true, data: undefined };
  } catch (error) {
    return mapTeamActionError(error, "Unable to update this member's role.");
  }
}

export async function deactivateWorkspaceMemberAction(
  workspaceSlug: string,
  input: unknown,
): Promise<TeamActionResult> {
  try {
    const parsed = workspaceMemberIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Member not found." };
    }

    const { workspace, supabase, user } =
      await requireTeamContext(workspaceSlug);
    requireCapability(workspace.role, "manage_workspace_members");

    const memberId = await callerMemberId(
      supabase,
      workspace.workspace_id,
      user?.id ?? "",
    );
    if (memberId && parsed.data.memberId === memberId) {
      return {
        success: false,
        message: messages.selfActionBlocked,
        code: "FORBIDDEN",
      };
    }

    const team = await fetchWorkspaceTeam(supabase, workspace.workspace_id);
    const target = team.members.find(
      (item) => item.member_id === parsed.data.memberId,
    );
    if (!target) {
      throw new TeamError(
        "MEMBER_NOT_FOUND",
        "Member not found in this workspace.",
      );
    }

    await deactivateWorkspaceMember(supabase, parsed.data);
    revalidateTeamPath(workspaceSlug);
    return { success: true, data: undefined };
  } catch (error) {
    return mapTeamActionError(error, "Unable to deactivate this member.");
  }
}

export async function removeWorkspaceMemberAction(
  workspaceSlug: string,
  input: unknown,
): Promise<TeamActionResult> {
  try {
    const parsed = workspaceMemberIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Member not found." };
    }

    const { workspace, supabase, user } =
      await requireTeamContext(workspaceSlug);
    requireCapability(workspace.role, "manage_workspace_members");

    const memberId = await callerMemberId(
      supabase,
      workspace.workspace_id,
      user?.id ?? "",
    );
    if (memberId && parsed.data.memberId === memberId) {
      return {
        success: false,
        message: messages.selfActionBlocked,
        code: "FORBIDDEN",
      };
    }

    const team = await fetchWorkspaceTeam(supabase, workspace.workspace_id);
    const target = team.members.find(
      (item) => item.member_id === parsed.data.memberId,
    );
    if (!target) {
      throw new TeamError(
        "MEMBER_NOT_FOUND",
        "Member not found in this workspace.",
      );
    }

    await removeWorkspaceMember(supabase, parsed.data);
    revalidateTeamPath(workspaceSlug);
    return { success: true, data: undefined };
  } catch (error) {
    return mapTeamActionError(error, "Unable to remove this member.");
  }
}
