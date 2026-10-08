import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { canonicalSite } from "./site";
export async function workspaceSites(workspaceId: string, requested?: string) {
  const { data, error } = await createServiceClient()
    .from("allowed_domains")
    .select("domain")
    .eq("workspace_id", workspaceId)
    .eq("verified", true);
  if (error) throw new Error("Could not load websites.");
  const sites = [...new Set(data.map((d) => canonicalSite(d.domain)))].sort();
  const selected = requested ? canonicalSite(requested) : undefined;
  if (selected && !sites.includes(selected))
    throw new Error("Choose an enabled website from installation settings.");
  return { sites, selected };
}
