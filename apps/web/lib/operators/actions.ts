"use server";
import { requireCapability } from "@/lib/permissions/require-capability";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import {
  effectiveOperatorStatus,
  type OperatorStatus,
  type OperatorAvailabilitySnapshot,
} from "./status";
const updateSchema = z
  .object({
    status: z.enum(["available", "away", "offline"]).optional(),
    idleTimeoutMinutes: z.number().int().min(0).max(120).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export async function updateOperatorAvailability(
  slug: string,
  input: {
    status?: OperatorStatus;
    idleTimeoutMinutes?: number;
    active?: boolean;
  } = {},
): Promise<OperatorAvailabilitySnapshot> {
  const parsed = updateSchema.parse(input);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(slug, membership.accessible_workspaces);
  if (!guard.ok) throw new Error("Workspace access denied.");
  requireCapability(guard.workspace.role, "send_messages");
  const { data: member, error: memberError } = await client
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", guard.workspace.workspace_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single<{ id: string }>();
  if (memberError) throw new Error("Workspace access denied.");
  const service = createServiceClient();
  // Create a preference row without overwriting an existing manual choice.
  const { error: initError } = await service
    .from("operator_availability")
    .upsert(
      { member_id: member.id },
      { onConflict: "member_id", ignoreDuplicates: true },
    );
  if (initError) throw new Error("Unable to load your status.");
  const now = new Date().toISOString();
  const patch: {
    last_seen_at: string;
    last_activity_at?: string;
    status?: OperatorStatus;
    idle_timeout_minutes?: number;
  } = { last_seen_at: now };
  if (parsed.status !== undefined) patch.status = parsed.status;
  if (parsed.idleTimeoutMinutes !== undefined)
    patch.idle_timeout_minutes = parsed.idleTimeoutMinutes;
  if (parsed.active === true || parsed.status === "available")
    patch.last_activity_at = now;
  // Background refreshes never write status or reset the inactivity timer.
  const { data, error } = await service
    .from("operator_availability")
    .update(patch)
    .eq("member_id", member.id)
    .select("status, last_activity_at, idle_timeout_minutes")
    .single();
  if (error) throw new Error("Unable to update your status.");
  const row = z
    .object({
      status: z.enum(["available", "away", "offline"]),
      last_activity_at: z.string().datetime({ offset: true }),
      idle_timeout_minutes: z.number().int().min(0).max(120),
    })
    .parse(data);
  const status = effectiveOperatorStatus(row);
  return {
    status,
    selectedStatus: row.status,
    idleTimeoutMinutes: row.idle_timeout_minutes,
    autoAway: row.status === "available" && status === "away",
  };
}

/** Compatibility for already-open dashboards from the previous deployment. */
export async function syncOperatorAvailability(
  slug: string,
  requestedStatus?: OperatorStatus,
) {
  return (await updateOperatorAvailability(slug, { status: requestedStatus }))
    .status;
}
