"use server";
import { z } from "zod";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { requireCapability } from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendConversationTranscript } from "./transcript";
export async function getConversationRatingAction(
  slug: string,
  conversationId: string,
) {
  const id = z.string().uuid().parse(conversationId);
  const { workspace } = await requireInboxWorkspace(slug);
  const { error } = await (
    await createClient()
  )
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspace.workspace_id)
    .eq("id", id)
    .single();
  if (error) throw new Error("Conversation not found.");
  const result = await createServiceClient()
    .from("conversation_ratings")
    .select("score,comment,created_at")
    .eq("workspace_id", workspace.workspace_id)
    .eq("conversation_id", id)
    .maybeSingle();
  if (result.error) throw new Error("Unable to load the rating.");
  return result.data;
}
export async function sendOperatorTranscriptAction(
  slug: string,
  input: unknown,
) {
  const parsed = z
    .object({
      conversationId: z.string().uuid(),
      requestId: z.string().uuid(),
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { success: false as const, message: "Enter a valid email address." };
  const { workspace } = await requireInboxWorkspace(slug);
  requireCapability(workspace.role, "send_messages");
  const { error } = await (
    await createClient()
  )
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspace.workspace_id)
    .eq("id", parsed.data.conversationId)
    .single();
  if (error)
    return { success: false as const, message: "Conversation not found." };
  try {
    await sendConversationTranscript({
      ...parsed.data,
      workspaceId: workspace.workspace_id,
    });
    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Unable to send the transcript.",
    };
  }
}
