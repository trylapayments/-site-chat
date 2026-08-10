import "server-only";

import {
  parseWorkspaceAIConfig,
  resolveAIFeatureFlags,
  type AIFeatureFlags,
  type WorkspaceAIConfig,
} from "@site-chat/ai";

import type { AppSupabaseClient } from "@/lib/supabase/server";

export type WorkspaceAIRuntimeConfig = {
  config: WorkspaceAIConfig;
  flags: AIFeatureFlags;
};

export async function loadWorkspaceAIConfig(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<WorkspaceAIRuntimeConfig> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("settings_json")
    .eq("id", workspaceId)
    .maybeSingle<{ settings_json: unknown }>();

  if (error) {
    throw error;
  }

  const settings =
    data?.settings_json && typeof data.settings_json === "object"
      ? (data.settings_json as Record<string, unknown>)
      : {};

  const config = parseWorkspaceAIConfig(settings.ai);
  const flags = resolveAIFeatureFlags({
    enabled: config.enabled,
    features: config.features,
  });

  return { config, flags };
}
