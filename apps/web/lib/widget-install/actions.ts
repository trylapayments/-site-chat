"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/lib/permissions/require-capability";
import { createServiceClient } from "@/lib/supabase/service";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
import { installDomainSchema } from "./domain";

const inputSchema = z
  .object({ domain: installDomainSchema, enabled: z.boolean() })
  .strict();

export async function setInstallDomainAction(slug: string, input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? "Check the domain.",
    };
  try {
    const { workspace } = await requireWidgetStudioWorkspace(slug);
    requireCapability(workspace.role, "manage_widget_studio");
    const client = createServiceClient();
    // Existing verified flag means explicitly approved for embedding. This is an
    // owner/admin allowlist decision, not a claim of DNS ownership verification.
    const result = await client
      .from("allowed_domains")
      .upsert(
        {
          workspace_id: workspace.workspace_id,
          domain: parsed.data.domain,
          verified: parsed.data.enabled,
        },
        { onConflict: "workspace_id,domain" },
      )
      .select("id,domain,verified")
      .single();
    if (result.error)
      return {
        success: false as const,
        message: result.error.message.startsWith("PLAN_SITE_LIMIT:")
          ? result.error.message.slice("PLAN_SITE_LIMIT:".length).trim()
          : "Could not update the domain. Please try again.",
      };
    revalidatePath(`/app/${slug}/settings/install`);
    return { success: true as const, domain: result.data };
  } catch {
    return {
      success: false as const,
      message: "Only workspace owners and admins can change allowed domains.",
    };
  }
}
