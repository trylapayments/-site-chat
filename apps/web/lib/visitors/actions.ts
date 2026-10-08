"use server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { z } from "zod";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { requireCapability } from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import { fetchActiveVisitors, type ActiveVisitor } from "./queries";
export type { ActiveVisitor } from "./queries";
export async function listVisitorsAction(
  slug: string,
): Promise<ActiveVisitor[]> {
  const { workspace } = await requireInboxWorkspace(slug);
  return fetchActiveVisitors(await createClient(), workspace.workspace_id);
}
export async function startVisitorChatAction(slug: string, input: unknown) {
  const parsed = z
    .object({
      visitorId: z.string().uuid(),
      message: z.string().trim().min(1).max(1000),
      requestId: z.string().uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return {
      success: false as const,
      message: "Enter a message (up to 1,000 characters).",
    };
  const { workspace } = await requireInboxWorkspace(slug);
  requireCapability(workspace.role, "send_messages");
  const { data, error } = await callPublicRpc(
    await createClient(),
    "start_visitor_chat",
    {
      p_workspace_id: workspace.workspace_id,
      p_visitor_session_id: parsed.data.visitorId,
      p_body: parsed.data.message,
      p_client_message_id: parsed.data.requestId,
    },
  );
  if (error)
    return {
      success: false as const,
      message: "Unable to invite this visitor. They may have left the website.",
    };
  const result = z.object({ conversationId: z.string().uuid() }).parse(data);
  return { success: true as const, conversationId: result.conversationId };
}
