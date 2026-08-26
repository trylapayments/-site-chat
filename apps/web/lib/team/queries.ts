import {
  createWorkspaceInvitationInputSchema,
  createWorkspaceInvitationResultSchema,
  listWorkspaceTeamResultSchema,
  parseTeamErrorMessage,
  revokeWorkspaceInvitationInputSchema,
  updateWorkspaceMemberRoleInputSchema,
  workspaceMemberIdInputSchema,
  type CreateWorkspaceInvitationInput,
  type CreateWorkspaceInvitationResult,
  type ListWorkspaceTeamResult,
  type RevokeWorkspaceInvitationInput,
  type UpdateWorkspaceMemberRoleInput,
  type WorkspaceMemberIdInput,
} from "@site-chat/shared";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import { callPublicRpc, parseRpcResult } from "@/lib/workspace/rpc";

function throwTeamRpcError(error: unknown): never {
  let message: string | null = null;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    const candidate = Reflect.get(error, "message");
    if (typeof candidate === "string") {
      message = candidate;
    }
  }
  const typed = parseTeamErrorMessage(message);
  if (typed) {
    throw typed;
  }
  throw error instanceof Error ? error : new Error("Team operation failed");
}

export async function fetchWorkspaceTeam(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<ListWorkspaceTeamResult> {
  const { data, error } = await callPublicRpc(supabase, "list_workspace_team", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    throwTeamRpcError(error);
  }

  return parseRpcResult(
    listWorkspaceTeamResultSchema,
    data,
    "list_workspace_team",
  );
}

export async function createWorkspaceInvitation(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: CreateWorkspaceInvitationInput,
): Promise<CreateWorkspaceInvitationResult> {
  const parsed = createWorkspaceInvitationInputSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "create_workspace_invitation",
    {
      p_workspace_id: workspaceId,
      p_email: parsed.email,
      p_role: parsed.role,
    },
  );

  if (error) {
    throwTeamRpcError(error);
  }

  return parseRpcResult(
    createWorkspaceInvitationResultSchema,
    data,
    "create_workspace_invitation",
  );
}

export async function revokeWorkspaceInvitation(
  supabase: AppSupabaseClient,
  input: RevokeWorkspaceInvitationInput,
): Promise<void> {
  const parsed = revokeWorkspaceInvitationInputSchema.parse(input);
  const { error } = await callPublicRpc(
    supabase,
    "revoke_workspace_invitation",
    {
      p_invitation_id: parsed.invitationId,
    },
  );

  if (error) {
    throwTeamRpcError(error);
  }
}

export async function updateWorkspaceMemberRole(
  supabase: AppSupabaseClient,
  input: UpdateWorkspaceMemberRoleInput,
): Promise<void> {
  const parsed = updateWorkspaceMemberRoleInputSchema.parse(input);
  const { error } = await callPublicRpc(
    supabase,
    "update_workspace_member_role",
    {
      p_member_id: parsed.memberId,
      p_new_role: parsed.role,
    },
  );

  if (error) {
    throwTeamRpcError(error);
  }
}

export async function promoteWorkspaceMemberToOwner(
  supabase: AppSupabaseClient,
  input: WorkspaceMemberIdInput,
): Promise<void> {
  const parsed = workspaceMemberIdInputSchema.parse(input);
  const { error } = await callPublicRpc(
    supabase,
    "promote_workspace_member_to_owner",
    {
      p_member_id: parsed.memberId,
    },
  );

  if (error) {
    throwTeamRpcError(error);
  }
}

export async function demoteWorkspaceOwner(
  supabase: AppSupabaseClient,
  input: UpdateWorkspaceMemberRoleInput,
): Promise<void> {
  const parsed = updateWorkspaceMemberRoleInputSchema.parse(input);
  const { error } = await callPublicRpc(supabase, "demote_workspace_owner", {
    p_member_id: parsed.memberId,
    p_new_role: parsed.role,
  });

  if (error) {
    throwTeamRpcError(error);
  }
}

export async function deactivateWorkspaceMember(
  supabase: AppSupabaseClient,
  input: WorkspaceMemberIdInput,
): Promise<void> {
  const parsed = workspaceMemberIdInputSchema.parse(input);
  const { error } = await callPublicRpc(
    supabase,
    "deactivate_workspace_member",
    {
      p_member_id: parsed.memberId,
    },
  );

  if (error) {
    throwTeamRpcError(error);
  }
}

export async function removeWorkspaceMember(
  supabase: AppSupabaseClient,
  input: WorkspaceMemberIdInput,
): Promise<void> {
  const parsed = workspaceMemberIdInputSchema.parse(input);
  const { error } = await callPublicRpc(supabase, "remove_workspace_member", {
    p_member_id: parsed.memberId,
  });

  if (error) {
    throwTeamRpcError(error);
  }
}
