import {
  globalSearchQuerySchema,
  globalSearchResultSchema,
  mapSearchResult,
  type GlobalSearchQuery,
  type GlobalSearchResult,
} from "@site-chat/shared";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import { callPublicRpc, parseRpcResult } from "@/lib/workspace/rpc";

export async function fetchGlobalSearch(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: GlobalSearchQuery,
): Promise<GlobalSearchResult> {
  const query = globalSearchQuerySchema.parse(input);
  const { data, error } = await callPublicRpc(supabase, "global_search", {
    p_workspace_id: workspaceId,
    p_query: {
      q: query.q,
      category: query.category,
      limit_per_type: query.limit_per_type,
    },
  });

  if (error) {
    throw new Error(error.message || "Search failed");
  }

  return mapSearchResult(
    parseRpcResult(globalSearchResultSchema, data, "global_search"),
  );
}
