import "server-only";

import {
  parseWorkspaceAIConfig,
  resolveAIFeatureFlags,
  type AIFeatureFlags,
  type WorkspaceAIConfig,
} from "@site-chat/ai";

import { workspaceBillingAccessForRender } from "@/lib/billing/access";
import { aiCreditBalance } from "@/lib/ai/credits";

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
  if (!config.enabled) {
    return {
      config,
      flags: resolveAIFeatureFlags({
        enabled: false,
        features: config.features,
      }),
    };
  }
  const access = await workspaceBillingAccessForRender(workspaceId);
  const balance = access.enabled ? await aiCreditBalance(workspaceId) : null;
  const aiDebt = access.disabledAddOns.some((id) =>
    /(^|[-_])ai([-_]|$)/i.test(id),
  );
  const flags = resolveAIFeatureFlags({
    enabled: access.enabled && (balance?.limit ?? 0) > 0 && !aiDebt,
    features: config.features,
  });

  return { config, flags };
}
