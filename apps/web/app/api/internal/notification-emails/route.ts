import { createHash, timingSafeEqual } from "node:crypto";

import { processNotificationEmailOutbox } from "@/lib/email/notification-email";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Called by the cloud scheduler, never by the visitor or operator browser. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.NOTIFICATION_EMAIL_CRON_SECRET;
  if (!secret || secret.length < 32) {
    return Response.json({ error: "Worker not configured" }, { status: 503 });
  }

  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const supplied = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest();
  if (!timingSafeEqual(expected, supplied)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return Response.json(
      { error: "Email delivery not configured" },
      { status: 503 },
    );
  }

  try {
    // Five sequential provider calls, each capped at ten seconds, fit the worker budget.
    const result = await processNotificationEmailOutbox({ limit: 5 });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Email processing failed" }, { status: 503 });
  }
}
