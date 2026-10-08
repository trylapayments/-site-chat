import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";

export async function workspaceCapacity(workspaceId: string) {
  const result = await createServiceClient().rpc("workspace_plan_capacity", {
    p_workspace_id: workspaceId,
  });
  if (result.error) throw new Error("Could not load plan limits.");
  return z
    .object({
      operators: z.number().int().nonnegative(),
      sites: z.number().int().nonnegative(),
      plan: z.string(),
    })
    .parse(result.data);
}
