import "server-only";
import {
  fetchConversations,
  fetchAssignableMembers,
} from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";
import { fetchActiveVisitors } from "@/lib/visitors/queries";
import { workspaceOperatorStatus } from "@/lib/operators/availability";
export async function loadOverview(workspace: { workspace_id: string }) {
  const client = await createClient();
  const [unassigned, mine, visitors, team, status] = await Promise.allSettled([
    fetchConversations(client, workspace.workspace_id, {
      status: "open",
      assignment: "unassigned",
      page: 1,
      pageSize: 10,
    }),
    fetchConversations(client, workspace.workspace_id, {
      status: "open",
      assignment: "assigned_to_me",
      page: 1,
      pageSize: 10,
    }),
    fetchActiveVisitors(client, workspace.workspace_id),
    fetchAssignableMembers(client, workspace.workspace_id),
    workspaceOperatorStatus(workspace.workspace_id),
  ]);
  return { unassigned, mine, visitors, team, status };
}
export type OverviewData = Awaited<ReturnType<typeof loadOverview>>;
