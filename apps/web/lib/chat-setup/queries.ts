import {
  chatSetupSchema,
  defaultChatSetup,
  type ChatSetup,
} from "@site-chat/shared";
import { createServiceClient } from "@/lib/supabase/service";
export async function fetchChatSetup(
  workspaceId: string,
): Promise<{ config: ChatSetup; version: number }> {
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
