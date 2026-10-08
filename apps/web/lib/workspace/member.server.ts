import "server-only";
import { cache } from "react";
import type { AppSupabaseClient } from "@/lib/supabase/server";

// Share the same identity query between nested layouts and the conversation page.
// React cache lives within a server render; membership stays fresh on each request.
export const fetchWorkspaceMemberIdentity = cache(
  async (supabase: AppSupabaseClient, workspaceId: string, userId: string) => {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    return data;
  },
);
