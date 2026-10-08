import { canonicalSite } from "@/lib/widget-install/site";
import {
  chatSetupSchema,
  defaultChatSetup,
  type ChatSetup,
} from "@site-chat/shared";
import { createServiceClient } from "@/lib/supabase/service";
export async function fetchChatSetup(
  workspaceId: string,
  site?: string,
): Promise<{ config: ChatSetup; version: number }> {
  let siteHost: string | null = null;
  if (site) {
    try {
      siteHost = canonicalSite(site);
    } catch {
      /* Local origins use workspace defaults. */
    }
  }
  if (siteHost) {
    const { data, error } = await createServiceClient()
      .from("site_chat_settings")
      .select("config,version")
      .eq("workspace_id", workspaceId)
      .eq("domain", siteHost)
      .maybeSingle();
    if (error) throw error;
    if (data)
      return {
        config: chatSetupSchema.parse(data.config),
        version: data.version,
      };
    const fallback = await fetchChatSetup(workspaceId);
    return fallback;
  }
  const { data, error } = await createServiceClient()
    .from("workspace_chat_settings")
    .select("config, version")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { config: chatSetupSchema.parse(data.config), version: data.version }
    : { config: defaultChatSetup, version: 0 };
}
