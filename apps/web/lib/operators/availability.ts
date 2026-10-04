import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  aggregateOperatorStatus,
  effectiveOperatorStatus,
  type OperatorStatus,
} from "./status";
export { aggregateOperatorStatus } from "./status";
export type { OperatorStatus } from "./status";
export async function workspaceOperatorStatus(
  workspaceId: string,
): Promise<OperatorStatus> {
  const { data, error } = await createServiceClient()
    .from("operator_availability")
    .select(
      "status, last_activity_at, idle_timeout_minutes, workspace_members!inner(workspace_id, status)",
    )
    .eq("workspace_members.workspace_id", workspaceId)
    .eq("workspace_members.status", "active")
    .in("workspace_members.role", ["owner", "admin", "agent"]);
  if (error) throw error;
  return aggregateOperatorStatus(
    data.map((row) => effectiveOperatorStatus(row)),
  );
}
