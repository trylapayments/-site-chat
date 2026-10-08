import type { Database } from "@site-chat/shared";
import {
  acceptInvitationResultSchema,
  listAccessibleWorkspacesSchema,
  type AcceptInvitationResult,
  type ListAccessibleWorkspacesResult,
} from "@site-chat/shared";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";

type UserPreferencesLastWorkspace = Pick<
  Database["public"]["Tables"]["user_preferences"]["Row"],
  "last_workspace_id"
>;

export async function fetchAccessibleWorkspaces(
  supabase: AppSupabaseClient,
): Promise<ListAccessibleWorkspacesResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "list_accessible_workspaces",
  );

  if (error) {
    throw error;
  }

  const parsed = listAccessibleWorkspacesSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Invalid list_accessible_workspaces response");
  }

  return parsed.data;
}

export async function fetchLastWorkspaceId(
  supabase: AppSupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("last_workspace_id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  const preferences = data as UserPreferencesLastWorkspace | null;
  return preferences?.last_workspace_id ?? null;
}

export async function setLastWorkspace(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await callPublicRpc(supabase, "set_last_workspace", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    throw error;
  }
}

export async function acceptWorkspaceInvitation(
  supabase: AppSupabaseClient,
  token: string,
): Promise<AcceptInvitationResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "accept_workspace_invitation",
    {
      p_token: token,
    },
  );

  if (error) {
    throw error;
  }

  const parsed = acceptInvitationResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Invalid accept_workspace_invitation response");
  }

  return parsed.data;
}

export async function validateWorkspaceInvitation(
  supabase: AppSupabaseClient,
  token: string,
) {
  const { data, error } = await callPublicRpc(
    supabase,
    "validate_workspace_invitation",
    {
      p_token: token,
    },
  );

  if (error) {
    throw error;
  }

  return data;
}
