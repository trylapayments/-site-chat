import {
  widgetAppearanceConfigSchema,
  widgetStudioStateSchema,
  type Json,
  type WidgetAppearanceConfig,
  type WidgetStudioState,
} from "@site-chat/shared";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import { callPublicRpc, parseRpcResult } from "@/lib/workspace/rpc";

function parseState(data: unknown): WidgetStudioState {
  return parseRpcResult(widgetStudioStateSchema, data, "Widget Studio state");
}

export async function fetchWidgetStudioState(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<WidgetStudioState> {
  const { data, error } = await callPublicRpc(
    supabase,
    "get_widget_studio_state",
    {
      p_workspace_id: workspaceId,
    },
  );

  if (error) {
    throw error;
  }

  return parseState(data);
}

export async function saveWidgetStudioDraft(
  supabase: AppSupabaseClient,
  workspaceId: string,
  draft: WidgetAppearanceConfig,
): Promise<WidgetStudioState> {
  const parsedDraft = widgetAppearanceConfigSchema.parse(draft);
  const { data, error } = await callPublicRpc(
    supabase,
    "save_widget_studio_draft",
    {
      p_workspace_id: workspaceId,
      p_draft: parsedDraft as Json,
    },
  );

  if (error) {
    throw error;
  }

  return parseState(data);
}

async function runStateMutation(
  supabase: AppSupabaseClient,
  functionName:
    | "publish_widget_studio"
    | "discard_widget_studio_draft"
    | "reset_widget_studio_draft",
  workspaceId: string,
): Promise<WidgetStudioState> {
  const { data, error } = await callPublicRpc(supabase, functionName, {
    p_workspace_id: workspaceId,
  });

  if (error) {
    throw error;
  }

  return parseState(data);
}

export function publishWidgetStudio(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<WidgetStudioState> {
  return runStateMutation(supabase, "publish_widget_studio", workspaceId);
}

export function discardWidgetStudioDraft(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<WidgetStudioState> {
  return runStateMutation(supabase, "discard_widget_studio_draft", workspaceId);
}

export function resetWidgetStudioDraft(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<WidgetStudioState> {
  return runStateMutation(supabase, "reset_widget_studio_draft", workspaceId);
}
