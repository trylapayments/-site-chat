import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { millEmailHtml } from "../mill-template";

const rowSchema = z.object({ id: z.string().uuid(), lease: z.string().uuid(), body: z.string(), sender_label: z.string(), to: z.string().email(), reply_token: z.string().regex(/^[a-f0-9]{64}$/), conversation_id: z.string().uuid() });
export async function processConversationEmailOutbox(limit = 50) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const domain = process.env.MILL_EMAIL_REPLY_DOMAIN;
  const result = { sent: 0, failed: 0 };
  if (!apiKey || !from || !domain || process.env.MILL_EMAIL_BRIDGE_ENABLED !== "true") return result;
  const client = createServiceClient();
  const started = Date.now();
  for (let count = 0; count < Math.min(limit, 50) && Date.now() - started < 35000; count += 1) {
    // Claim only work that can finish within the serverless budget.
    const claimed = await client.rpc("claim_conversation_email_outbox" as never, { p_limit: 1 } as never);
    if (claimed.error) throw new Error("Customer email claim failed");
    const row = z.array(rowSchema).parse(claimed.data)[0];
    if (!row) break;
    // Leave headroom for the existing notification queue and provider rate limits.
    if (count > 0) await new Promise<void>((resolve) => setTimeout(resolve, 550));
    let status: "sent" | "failed" = "failed";
    let providerId: string | null = null;
    let error: string | null = "Provider unavailable";
    try {
      const subject = `${row.sender_label} replied to your conversation`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `mill-conversation/${row.id}` },
        body: JSON.stringify({ from, to: [row.to], reply_to: `${row.reply_token}@${domain}`, subject,
          text: `${row.sender_label}\n\n${row.body}\n\nReply to this email to continue your conversation.\nMill — mill.chat`,
          html: millEmailHtml({ title: subject, paragraphs: ["You have a new reply. Reply to this email to continue the conversation."], preformatted: row.body, footer: "You received this email because you contacted our team through Mill. Your reply returns to the same conversation." }) }),
      });
      if (response.ok) {
        const json = z.object({ id: z.string() }).parse(await response.json());
        providerId = json.id; status = "sent"; error = null;
      } else error = `Provider HTTP ${String(response.status)}`;
    } catch { /* Retry from the durable queue, without logging message content. */ }
    const finalized = await client.rpc("finalize_conversation_email_outbox" as never,
      { p_id: row.id, p_lease: row.lease, p_status: status, p_provider_id: providerId, p_error: error } as never);
    if (finalized.error || finalized.data !== true) throw new Error("Customer email finalization failed");
    result[status === "sent" ? "sent" : "failed"] += 1;
  }
  return result;
}
