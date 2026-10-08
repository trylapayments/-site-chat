import {
  cannedFolderSchema,
  cannedResponseSchema,
  createCannedFolderSchema,
  createCannedResponseSchema,
  listCannedFoldersQuerySchema,
  listCannedFoldersResultSchema,
  listCannedResponsesQuerySchema,
  listCannedResponsesResultSchema,
  parseCannedErrorMessage,
  recordCannedResponseUsageSchema,
  setCannedResponseFavoriteSchema,
  softDeleteCannedFolderSchema,
  softDeleteCannedResponseSchema,
  updateCannedFolderSchema,
  updateCannedResponseSchema,
  type CannedFolder,
  type CannedResponse,
  type CannedVisibility,
  type CreateCannedFolderInput,
  type CreateCannedResponseInput,
  type ListCannedFoldersQuery,
  type ListCannedFoldersResult,
  type ListCannedResponsesQuery,
  type ListCannedResponsesResult,
  type RecordCannedResponseUsageInput,
  type SetCannedResponseFavoriteInput,
  type SoftDeleteCannedFolderInput,
  type SoftDeleteCannedResponseInput,
  type UpdateCannedFolderInput,
  type UpdateCannedResponseInput,
} from "@site-chat/shared";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import {
  callPublicRpc,
  callPublicRpcNullable,
  parseRpcResult,
} from "@/lib/workspace/rpc";

function throwCannedRpcError(error: unknown): never {
  let message: string | null = null;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    const candidate = Reflect.get(error, "message");
    if (typeof candidate === "string") {
      message = candidate;
    }
  }
  const typed = parseCannedErrorMessage(message);
  if (typed) {
    throw typed;
  }
  throw error instanceof Error
    ? error
    : new Error("Canned response operation failed");
}

export async function fetchCannedResponses(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListCannedResponsesQuery = {},
): Promise<ListCannedResponsesResult> {
  const validated = listCannedResponsesQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(
    supabase,
    "list_canned_responses",
    {
      p_workspace_id: workspaceId,
      p_query: validated,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    listCannedResponsesResultSchema,
    data,
    "list_canned_responses",
  );
}

export async function fetchCannedResponse(
  supabase: AppSupabaseClient,
  workspaceId: string,
  cannedResponseId: string,
): Promise<CannedResponse> {
  const { data, error } = await callPublicRpc(supabase, "get_canned_response", {
    p_workspace_id: workspaceId,
    p_id: cannedResponseId,
  });

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(cannedResponseSchema, data, "get_canned_response");
}

export async function fetchCannedFolders(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListCannedFoldersQuery = {},
): Promise<ListCannedFoldersResult> {
  const validated = listCannedFoldersQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(
    supabase,
    "list_canned_response_folders",
    {
      p_workspace_id: workspaceId,
      p_query: validated,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    listCannedFoldersResultSchema,
    data,
    "list_canned_response_folders",
  );
}

/**
 * Visibility of a folder the caller may see. There is no `get_folder` RPC, and
 * the Server Action needs the scope before it can pick the right capability
 * gate (shared folders require manage, personal ones only use).
 */
export async function fetchCannedFolderVisibility(
  supabase: AppSupabaseClient,
  workspaceId: string,
  folderId: string,
): Promise<CannedVisibility | null> {
  const folders = await fetchCannedFolders(supabase, workspaceId, {});
  return (
    folders.items.find((folder) => folder.id === folderId)?.visibility ?? null
  );
}

export async function createCannedResponse(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: CreateCannedResponseInput,
): Promise<CannedResponse> {
  const validated = createCannedResponseSchema.parse(input);
  const { data, error } = await callPublicRpcNullable(
    supabase,
    "create_canned_response",
    {
      p_workspace_id: workspaceId,
      p_title: validated.title,
      p_body: validated.body,
      p_shortcut: validated.shortcut,
      p_visibility: validated.visibility,
      p_folder_id: validated.folderId,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(cannedResponseSchema, data, "create_canned_response");
}

export async function updateCannedResponse(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UpdateCannedResponseInput,
): Promise<CannedResponse> {
  const validated = updateCannedResponseSchema.parse(input);
  const { data, error } = await callPublicRpcNullable(
    supabase,
    "update_canned_response",
    {
      p_workspace_id: workspaceId,
      p_id: validated.cannedResponseId,
      p_title: validated.title,
      p_body: validated.body,
      p_shortcut: validated.shortcut,
      p_folder_id: validated.folderId,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(cannedResponseSchema, data, "update_canned_response");
}

export async function softDeleteCannedResponse(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SoftDeleteCannedResponseInput,
): Promise<CannedResponse> {
  const validated = softDeleteCannedResponseSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "soft_delete_canned_response",
    {
      p_workspace_id: workspaceId,
      p_id: validated.cannedResponseId,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    cannedResponseSchema,
    data,
    "soft_delete_canned_response",
  );
}

export async function setCannedResponseFavorite(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SetCannedResponseFavoriteInput,
): Promise<CannedResponse> {
  const validated = setCannedResponseFavoriteSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "set_canned_response_favorite",
    {
      p_workspace_id: workspaceId,
      p_id: validated.cannedResponseId,
      p_favorited: validated.favorited,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    cannedResponseSchema,
    data,
    "set_canned_response_favorite",
  );
}

export async function recordCannedResponseUsage(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: RecordCannedResponseUsageInput,
): Promise<CannedResponse> {
  const validated = recordCannedResponseUsageSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "record_canned_response_usage",
    {
      p_workspace_id: workspaceId,
      p_id: validated.cannedResponseId,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    cannedResponseSchema,
    data,
    "record_canned_response_usage",
  );
}

export async function createCannedFolder(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: CreateCannedFolderInput,
): Promise<CannedFolder> {
  const validated = createCannedFolderSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "create_canned_response_folder",
    {
      p_workspace_id: workspaceId,
      p_name: validated.name,
      p_visibility: validated.visibility,
      p_sort_order: validated.sortOrder,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    cannedFolderSchema,
    data,
    "create_canned_response_folder",
  );
}

export async function updateCannedFolder(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UpdateCannedFolderInput,
): Promise<CannedFolder> {
  const validated = updateCannedFolderSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "update_canned_response_folder",
    {
      p_workspace_id: workspaceId,
      p_id: validated.folderId,
      p_name: validated.name,
      p_sort_order: validated.sortOrder,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    cannedFolderSchema,
    data,
    "update_canned_response_folder",
  );
}

export async function softDeleteCannedFolder(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SoftDeleteCannedFolderInput,
): Promise<CannedFolder> {
  const validated = softDeleteCannedFolderSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "soft_delete_canned_response_folder",
    {
      p_workspace_id: workspaceId,
      p_id: validated.folderId,
    },
  );

  if (error) {
    throwCannedRpcError(error);
  }

  return parseRpcResult(
    cannedFolderSchema,
    data,
    "soft_delete_canned_response_folder",
  );
}
