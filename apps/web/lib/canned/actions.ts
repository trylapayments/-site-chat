"use server";

import {
  CannedError,
  createCannedFolderSchema,
  createCannedResponseSchema,
  listCannedFoldersQuerySchema,
  listCannedResponsesQuerySchema,
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
  type ListCannedFoldersResult,
  type ListCannedResponsesResult,
  type MemberRole,
} from "@site-chat/shared";
import { revalidatePath } from "next/cache";

import { requireCannedWorkspace } from "@/lib/canned/guards";
import {
  createCannedFolder,
  createCannedResponse,
  fetchCannedFolderVisibility,
  fetchCannedFolders,
  fetchCannedResponse,
  fetchCannedResponses,
  recordCannedResponseUsage,
  setCannedResponseFavorite,
  softDeleteCannedFolder,
  softDeleteCannedResponse,
  updateCannedFolder,
  updateCannedResponse,
} from "@/lib/canned/queries";
import {
  SETTINGS_SECTION_CANNED_RESPONSES,
  workspaceNavPath,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";

export type CannedActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string };

function mapCannedActionError<T>(
  error: unknown,
  fallback: string,
): CannedActionResult<T> {
  if (error instanceof CapabilityError) {
    return { success: false, message: error.message, code: "FORBIDDEN" };
  }
  if (error instanceof CannedError) {
    return { success: false, message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    const typed = parseCannedErrorMessage(error.message);
    if (typed) {
      return { success: false, message: typed.message, code: typed.code };
    }
  }
  return { success: false, message: fallback };
}

async function requireCannedContext(workspaceSlug: string) {
  const { workspace } = await requireCannedWorkspace(workspaceSlug);
  const supabase = await createClient();
  return { workspace, supabase };
}

/**
 * Personal snippets and folders are managed by any member who may use canned
 * responses; shared ones require the workspace-manage capability. The RPCs
 * re-check both (and ownership) — this keeps the UX error typed and local.
 */
function requireScopeCapability(
  role: MemberRole,
  visibility: CannedVisibility,
): void {
  requireCapability(
    role,
    visibility === "workspace"
      ? "manage_workspace_canned_responses"
      : "use_canned_responses",
  );
}

function revalidateSettings(workspaceSlug: string): void {
  revalidatePath(
    workspaceSettingsPath(workspaceSlug, SETTINGS_SECTION_CANNED_RESPONSES),
  );
}

/** Composer snippets are prefetched on the conversation page. */
function revalidateInbox(workspaceSlug: string): void {
  revalidatePath(workspaceNavPath(workspaceSlug, "inbox"), "layout");
}

export async function listCannedResponsesAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<CannedActionResult<ListCannedResponsesResult>> {
  try {
    const parsed = listCannedResponsesQuerySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid canned response query." };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);
    requireCapability(workspace.role, "view_canned_responses");

    const data = await fetchCannedResponses(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to load canned responses.");
  }
}

export async function listCannedResponseFoldersAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<CannedActionResult<ListCannedFoldersResult>> {
  try {
    const parsed = listCannedFoldersQuerySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid folder query." };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);
    requireCapability(workspace.role, "view_canned_responses");

    const data = await fetchCannedFolders(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to load folders.");
  }
}

export async function createCannedResponseAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedResponse>> {
  try {
    const parsed = createCannedResponseSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid canned response.",
      };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);
    requireScopeCapability(workspace.role, parsed.data.visibility);

    const data = await createCannedResponse(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    revalidateInbox(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to create canned response.");
  }
}

export async function updateCannedResponseAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedResponse>> {
  try {
    const parsed = updateCannedResponseSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message:
          parsed.error.issues[0]?.message ?? "Invalid canned response update.",
      };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);

    // Visibility is immutable, so the stored row decides which gate applies.
    const existing = await fetchCannedResponse(
      supabase,
      workspace.workspace_id,
      parsed.data.cannedResponseId,
    );
    requireScopeCapability(workspace.role, existing.visibility);

    const data = await updateCannedResponse(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    revalidateInbox(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to update canned response.");
  }
}

export async function softDeleteCannedResponseAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedResponse>> {
  try {
    const parsed = softDeleteCannedResponseSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid canned response." };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);

    const existing = await fetchCannedResponse(
      supabase,
      workspace.workspace_id,
      parsed.data.cannedResponseId,
    );
    requireScopeCapability(workspace.role, existing.visibility);

    const data = await softDeleteCannedResponse(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    revalidateInbox(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to delete canned response.");
  }
}

export async function setCannedResponseFavoriteAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedResponse>> {
  try {
    const parsed = setCannedResponseFavoriteSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid favorite request." };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);
    requireCapability(workspace.role, "use_canned_responses");

    const data = await setCannedResponseFavorite(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to update favorite.");
  }
}

/**
 * Fire-and-forget usage telemetry after an insertion. Deliberately does not
 * revalidate: `usage_count` never bumps `updated_at`, so counters converge on
 * the next list rather than invalidating the composer route on every insert.
 */
export async function recordCannedResponseUsageAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedResponse>> {
  try {
    const parsed = recordCannedResponseUsageSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid usage request." };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);
    requireCapability(workspace.role, "use_canned_responses");

    const data = await recordCannedResponseUsage(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to record usage.");
  }
}

export async function createCannedResponseFolderAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedFolder>> {
  try {
    const parsed = createCannedFolderSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid folder.",
      };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);
    requireScopeCapability(workspace.role, parsed.data.visibility);

    const data = await createCannedFolder(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to create folder.");
  }
}

export async function updateCannedResponseFolderAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedFolder>> {
  try {
    const parsed = updateCannedFolderSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid folder update.",
      };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);

    const visibility = await fetchCannedFolderVisibility(
      supabase,
      workspace.workspace_id,
      parsed.data.folderId,
    );
    if (!visibility) {
      return {
        success: false,
        message: "Folder not found.",
        code: "FOLDER_NOT_FOUND",
      };
    }
    requireScopeCapability(workspace.role, visibility);

    const data = await updateCannedFolder(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to update folder.");
  }
}

export async function softDeleteCannedResponseFolderAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CannedActionResult<CannedFolder>> {
  try {
    const parsed = softDeleteCannedFolderSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid folder." };
    }

    const { workspace, supabase } = await requireCannedContext(workspaceSlug);

    const visibility = await fetchCannedFolderVisibility(
      supabase,
      workspace.workspace_id,
      parsed.data.folderId,
    );
    if (!visibility) {
      return {
        success: false,
        message: "Folder not found.",
        code: "FOLDER_NOT_FOUND",
      };
    }
    requireScopeCapability(workspace.role, visibility);

    const data = await softDeleteCannedFolder(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    revalidateSettings(workspaceSlug);
    revalidateInbox(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCannedActionError(error, "Unable to delete folder.");
  }
}
