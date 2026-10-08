import "server-only";
import { AIError } from "@site-chat/ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
const balanceSchema = z.object({
  start: z.string(),
  end: z.string(),
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
});
export async function aiCreditBalance(workspaceId: string) {
  const { data, error } = await createServiceClient().rpc(
    "workspace_ai_credit_balance",
    { p_workspace_id: workspaceId },
  );
  if (error) throw new Error("AI balance is unavailable.");
  return balanceSchema.parse(data);
}
export async function reserveAICredit(
  workspaceId: string,
  conversationId: string,
  requestId: string,
) {
  const { error } = await createServiceClient().rpc(
    "reserve_ai_conversation_credit",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_request_id: requestId,
    },
  );
  if (error) {
    if (error.message.startsWith("AI_QUOTA_EXHAUSTED:"))
      throw new AIError(
        "AI_QUOTA_EXHAUSTED",
        "Your included AI conversations are used up. Live chat remains available.",
      );
    if (error.message.startsWith("AI_BUSY:"))
      throw new AIError(
        "AI_RATE_LIMITED",
        "An AI reply is already being prepared for this conversation.",
      );
    throw new AIError("AI_UNAVAILABLE", "AI credit check failed.");
  }
}
export async function finishAICredit(
  workspaceId: string,
  requestId: string,
  success: boolean,
) {
  const { error } = await createServiceClient().rpc(
    "finish_ai_conversation_credit",
    {
      p_workspace_id: workspaceId,
      p_request_id: requestId,
      p_success: success,
    },
  );
  if (error)
    throw new AIError("AI_UNAVAILABLE", "AI credit confirmation failed.");
}

export async function aiCreditHistory(workspaceId: string) {
  const { data, error } = await createServiceClient()
    .from("ai_conversation_credits")
    .select("conversation_id,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "success")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw new Error("AI usage history is unavailable.");
  return data;
}
