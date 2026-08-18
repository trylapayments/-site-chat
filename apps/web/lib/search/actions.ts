"use server";

import {
  can,
  filterHitsForPermissions,
  globalSearchQuerySchema,
  type GlobalSearchResult,
} from "@site-chat/shared";

import { CapabilityError } from "@/lib/permissions/require-capability";
import { requireSearchWorkspace } from "@/lib/search/guards";
import { fetchGlobalSearch } from "@/lib/search/queries";
import { createClient } from "@/lib/supabase/server";

export type GlobalSearchActionResult =
  | { success: true; data: GlobalSearchResult }
  | { success: false; message: string; code?: string };

export async function globalSearchAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<GlobalSearchActionResult> {
  try {
    const { workspace } = await requireSearchWorkspace(workspaceSlug);
    const parsed = globalSearchQuerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Invalid search query.",
        code: "INVALID_QUERY",
      };
    }

    const supabase = await createClient();
    const result = await fetchGlobalSearch(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );

    const canSearchNotes = can(workspace.role, "manage_internal_notes");
    return {
      success: true,
      data: filterHitsForPermissions(result, canSearchNotes),
    };
  } catch (error) {
    if (error instanceof CapabilityError) {
      return { success: false, message: error.message, code: "FORBIDDEN" };
    }
    return {
      success: false,
      message: "Search failed. Please try again.",
      code: "SEARCH_FAILED",
    };
  }
}
