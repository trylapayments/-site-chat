"use server";
import { requireCapability } from "@/lib/permissions/require-capability";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import type { OperatorStatus } from "./availability";
export async function syncOperatorAvailability(
  slug: string,
  requestedStatus?: OperatorStatus,
) {
  const parsed = z
    .enum(["available", "away", "offline"])
    .optional()
    .parse(requestedStatus);
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
  if (parsed !== undefined) {
    const { error } = await service.from("operator_availability").upsert({
      member_id: member.id,
      status: parsed,
      last_seen_at: new Date().toISOString(),
    });
    if (error) throw new Error("Unable to update your status.");
    return parsed;
  }
  // Heartbeats never overwrite a choice made in another tab.
  const { data, error } = await service
    .from("operator_availability")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("member_id", member.id)
    .select("status")
    .maybeSingle();
  if (error) throw new Error("Unable to refresh your status.");
  return z
    .enum(["available", "away", "offline"])
    .parse(data?.status ?? "offline");
}
