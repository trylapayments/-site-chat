import { dispatchMobilePush } from "@/lib/mobile/dispatch";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { dispatchNotificationEmails } from "@/lib/email/dispatch-notifications";
import {
  htmlReplyText,
  incomingReplyText,
  isAutomatedEmail,
  mailboxAddress,
  replyToken,
  verifyInboundSignature,
} from "@/lib/email/conversation/inbound";

export const runtime = "nodejs";
export const maxDuration = 60;
const eventSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().uuid() }).passthrough(),
});
const emailSchema = z.object({
  id: z.string().uuid(),
  from: z.string(),
  to: z.array(z.string()),
  text: z.string().nullable(),
  html: z.string().nullable().optional(),
  headers: z.record(z.string()).default({}),
  authentication: z.object({ dmarc: z.string() }),
  attachments: z
    .array(z.object({ filename: z.string().nullable() }).passthrough())
    .default([]),
});
const respond = (status = 200) =>
  Response.json(
    { received: status === 200 },
    { status, headers: { "Cache-Control": "no-store" } },
  );

/** Public endpoint, authorized only by the provider's signed raw webhook. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_RECEIVING_API_KEY;
  const domain = process.env.MILL_EMAIL_REPLY_DOMAIN;
  if (
    !secret ||
    !apiKey ||
    !domain ||
    process.env.MILL_EMAIL_BRIDGE_ENABLED !== "true"
  )
    return respond(503);
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    return respond(413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) return respond(413);
  if (!verifyInboundSignature(raw, request.headers, secret))
    return respond(401);
  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(raw));
  } catch {
    return respond(400);
  }
  if (event.type !== "email.received") return respond();
  try {
    const response = await fetch(
      `https://api.resend.com/emails/receiving/${event.data.email_id}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      },
    );
    if (!response.ok) return respond(503);
    const email = emailSchema.parse(await response.json());
    if (
      email.id !== event.data.email_id ||
      email.authentication.dmarc !== "pass" ||
      isAutomatedEmail(email.headers)
    )
      return respond();
    const token = replyToken(email.to, domain);
    const sender = mailboxAddress(email.from);
    if (!token || !sender) return respond();
    // Preserve notification of attachments; file transport is added separately.
    const attachments = email.attachments
      .map(
        (attachment) =>
          `[Email attachment: ${attachment.filename ?? "unnamed file"}]`,
      )
      .join("\n");
    const body = [
      email.text
        ? incomingReplyText(email.text)
        : htmlReplyText(email.html ?? ""),
      attachments,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!body || body.length > 20000) return respond();
    const client = createServiceClient();
    const received = await client.rpc(
      "receive_conversation_email" as never,
      {
        p_provider_id: email.id,
        p_token: token,
        p_sender: sender,
        p_body: body,
      } as never,
    );
    if (received.error) return respond(503);
    if (received.data === "received") {
      dispatchNotificationEmails();
      dispatchMobilePush();
    }
    return respond();
  } catch {
    return respond(503);
  }
}
