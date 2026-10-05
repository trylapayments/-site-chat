import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { formatTranscript } from "./transcript-format";
const transcriptPageSchema = z.object({
  workspaceName: z.string(),
  messages: z.array(
    z.object({
      sender_type: z.enum(["visitor", "agent", "system"]),
      body: z.string(),
      is_internal: z.literal(false),
      created_at: z.string(),
      metadata_json: z
        .object({
          attachments: z.array(z.object({ filename: z.string() })).default([]),
        })
        .default({}),
      agent_member_id: z.string().nullable(),
      agent_name: z.string(),
    }),
  ),
});
export async function sendConversationTranscript(input: {
  workspaceId: string;
  conversationId: string;
  requestId: string;
  email: string;
}) {
  const service = createServiceClient();
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    throw new Error(
      "Transcript email is not configured. Please contact the team.",
    );
  const { data: claim, error } = await service.rpc(
    "claim_conversation_transcript",
    {
      p_workspace_id: input.workspaceId,
      p_conversation_id: input.conversationId,
      p_request_id: input.requestId,
      p_recipient: input.email,
    },
  );
  if (error) throw new Error("Unable to send this transcript.");
  if (claim === "sent") return;
  if (claim !== "claimed")
    throw new Error(
      claim === "limited"
        ? "Too many transcript requests. Try again in an hour."
        : "This transcript is already being sent. Please try again shortly.",
    );
  try {
    const snapshot = await service
      .from("conversation_transcript_requests")
      .select("payload")
      .eq("workspace_id", input.workspaceId)
      .eq("conversation_id", input.conversationId)
      .eq("id", input.requestId)
      .single();
    if (snapshot.error)
      throw new Error("Unable to load the transcript request.");
    let payload = snapshot.data.payload;
    if (!payload) {
      const messages = [];
      const names = new Map<string, string>();
      let workspaceName = "Mill";
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await service.rpc(
          "read_conversation_transcript",
          {
            p_workspace_id: input.workspaceId,
            p_request_id: input.requestId,
            p_offset: offset,
          },
        );
        if (error) throw new Error("Unable to load the transcript.");
        const page = transcriptPageSchema.parse(data);
        workspaceName = page.workspaceName;
        messages.push(...page.messages);
        for (const message of page.messages)
          if (message.agent_member_id)
            names.set(message.agent_member_id, message.agent_name);
        if (page.messages.length < 500) break;
      }
      const text = formatTranscript(workspaceName, messages, names);
      payload = {
        from:
          process.env.RESEND_FROM_EMAIL ??
          "Mill <notifications@notify.mill.chat>",
        to: [input.email],
        subject: `Your ${workspaceName} conversation transcript`,
        text,
        attachments: [
          {
            filename: "conversation.txt",
            content: Buffer.from(text).toString("base64"),
          },
        ],
      };
      const saved = await service
        .from("conversation_transcript_requests")
        .update({ payload })
        .eq("workspace_id", input.workspaceId)
        .eq("conversation_id", input.conversationId)
        .eq("id", input.requestId);
      if (saved.error)
        throw new Error("Unable to save the transcript request.");
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `mill-transcript-${input.requestId}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error("Email could not be sent. Please try again.");
    const { error: finalError } = await service
      .from("conversation_transcript_requests")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.requestId);
    if (finalError)
      throw new Error("Unable to confirm delivery. Retry this request.");
  } catch (error) {
    await service
      .from("conversation_transcript_requests")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.requestId);
    throw error;
  }
}
