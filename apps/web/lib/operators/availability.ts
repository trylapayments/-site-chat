import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
export type OperatorStatus = "available" | "away" | "offline";
export const OPERATOR_LEASE_MS = 90_000;
export function aggregateOperatorStatus(
  statuses: readonly string[],
): OperatorStatus {
  return statuses.includes("available")
    ? "available"
    : statuses.includes("away")
      ? "away"
      : "offline";
}
export async function workspaceOperatorStatus(
  workspaceId: string,
): Promise<OperatorStatus> {
  const { data, error } = await createServiceClient()
    .from("operator_availability")
    .select("status, workspace_members!inner(workspace_id, status)")
    .eq("workspace_members.workspace_id", workspaceId)
    .eq("workspace_members.status", "active")
    .in("workspace_members.role", ["owner", "admin", "agent"])
    .gte(
      "last_seen_at",
      new Date(Date.now() - OPERATOR_LEASE_MS).toISOString(),
    );
  if (error) throw error;
  return aggregateOperatorStatus(data.map((row) => row.status));
}
