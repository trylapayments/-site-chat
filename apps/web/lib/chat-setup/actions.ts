"use server";
import { chatSetupSchema } from "@site-chat/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/lib/permissions/require-capability";
import { createServiceClient } from "@/lib/supabase/service";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
const inputSchema = z
  .object({ config: chatSetupSchema, version: z.number().int().min(0) })
  .strict();
export async function saveChatSetupAction(slug: string, input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? "Check the form settings.",
    };
  const { workspace } = await requireWidgetStudioWorkspace(slug);
  requireCapability(workspace.role, "manage_widget_studio");
  const { config, version } = parsed.data;
  const client = createServiceClient();
  const result =
    version === 0
      ? await client
          .from("workspace_chat_settings")
          .insert({ workspace_id: workspace.workspace_id, config, version: 1 })
          .select("version")
          .single()
      : await client
          .from("workspace_chat_settings")
          .update({
            config,
            version: version + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspace.workspace_id)
          .eq("version", version)
          .select("version")
          .maybeSingle();
  if (result.error || !result.data)
    return {
      success: false as const,
      message:
        "Settings changed in another window. Reload the page before saving.",
    };
  revalidatePath(`/app/${slug}/settings/chat-setup`);
  return { success: true as const, version: result.data.version };
}
