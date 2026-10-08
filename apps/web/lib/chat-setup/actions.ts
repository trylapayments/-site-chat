"use server";
import { workspaceSites } from "@/lib/widget-install/sites.server";
import { chatSetupSchema } from "@site-chat/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/lib/permissions/require-capability";
import { createServiceClient } from "@/lib/supabase/service";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
const inputSchema = z
  .object({ config: chatSetupSchema, version: z.number().int().min(0) })
  .strict();
export async function saveChatSetupAction(
  slug: string,
  input: unknown,
  siteDomain?: string,
) {
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
  if (siteDomain) {
    const { selected } = await workspaceSites(
      workspace.workspace_id,
      siteDomain,
    );
    if (!selected) throw new Error("Choose a website.");
    const { data: appearance } = await client
      .from("widget_configs")
      .select("published_json,published_version")
      .eq("workspace_id", workspace.workspace_id)
      .single();
    if (!appearance) throw new Error("Save the website widget design first.");
    const initialized = await client.from("widget_site_configs").upsert(
      {
        workspace_id: workspace.workspace_id,
        domain: selected,
        draft_json: appearance.published_json,
        published_json: appearance.published_json,
        published_version: appearance.published_version,
      },
      { onConflict: "workspace_id,domain", ignoreDuplicates: true },
    );
    if (initialized.error)
      throw new Error("Could not initialize website settings.");
    const result =
      version === 0
        ? await client
            .from("site_chat_settings")
            .insert({
              workspace_id: workspace.workspace_id,
              domain: selected,
              config,
              version: 1,
            })
            .select("version")
            .single()
        : await client
            .from("site_chat_settings")
            .update({
              config,
              version: version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("workspace_id", workspace.workspace_id)
            .eq("domain", selected)
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
