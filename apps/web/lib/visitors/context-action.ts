"use server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { z } from "zod";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
export async function getConversationEngagementAction(
  slug: string,
  conversationId: string,
) {
  const id = z.string().uuid().parse(conversationId);
  const { workspace } = await requireInboxWorkspace(slug);
  const { data, error } = await callPublicRpc(
    await createClient(),
    "get_conversation_engagement",
    {
      p_workspace_id: workspace.workspace_id,
      p_conversation_id: id,
    },
  );
  if (error) throw new Error("Unable to load visitor details.");
  return z
    .object({
      ip: z.string().nullable(),
      submission: z
        .object({
          name: z.string(),
          email: z.string(),
          phone: z.string(),
          fields: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              type: z.string(),
              value: z.union([z.string(), z.boolean(), z.null()]),
            }),
          ),
        })
        .nullable(),
    })
    .nullable()
    .parse(data);
}
