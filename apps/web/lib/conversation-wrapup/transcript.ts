import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { formatTranscript } from "./transcript-format";
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
      const workspace = await service
        .from("workspaces")
        .select("name")
        .eq("id", input.workspaceId)
        .single();
      if (workspace.error) throw new Error("Unable to load the transcript.");
      // Paginate rather than silently truncating a long conversation at PostgREST's row cap.
      const messages = [];
      for (let offset = 0; ; offset += 500) {
        const result = await service
          .from("messages")
          .select(
            "sender_type,body,is_internal,created_at,metadata_json,agent_member_id",
          )
          .eq("workspace_id", input.workspaceId)
          .eq("conversation_id", input.conversationId)
          .eq("is_internal", false)
          .order("sequence_number")
          .range(offset, offset + 499);
        if (result.error) throw new Error("Unable to load the transcript.");
        messages.push(...result.data);
        if (result.data.length < 500) break;
      }
      const memberIds = [
        ...new Set(
          messages
            .map((m) => m.agent_member_id)
            .filter((id): id is string => !!id),
        ),
      ];
      const names = new Map<string, string>();
      if (memberIds.length) {
        const profiles = await service
          .from("agent_profiles")
          .select("member_id,display_name")
          .eq("workspace_id", input.workspaceId)
          .in("member_id", memberIds);
        if (profiles.error) throw new Error("Unable to load the transcript.");
        for (const p of profiles.data) names.set(p.member_id, p.display_name);
      }
      const text = formatTranscript(workspace.data.name, messages, names);
      payload = {
        from:
          process.env.RESEND_FROM_EMAIL ??
          "Mill <notifications@notify.mill.chat>",
        to: [input.email],
        subject: `Your ${workspace.data.name} conversation transcript`,
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
