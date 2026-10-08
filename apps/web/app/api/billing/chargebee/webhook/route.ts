import { sendSubscriptionEmail } from "@/lib/billing/subscription-email";
import { z } from "zod";
import type { Json } from "@site-chat/shared";
import { chargebeeRequest, chargebeeSite } from "@/lib/billing/chargebee";
import { validBillingWebhookAuth } from "@/lib/billing/webhook-auth";
import { createServiceClient } from "@/lib/supabase/service";
export const runtime = "nodejs";
const resource = z
  .object({
    id: z.string(),
    customer_id: z.string().optional(),
    resource_version: z.number().int().positive(),
  })
  .passthrough();
const event = z.object({
  event: z.object({
    id: z.string(),
    event_type: z.string(),
    content: z.record(z.unknown()),
  }),
});
export async function POST(request: Request) {
  if (
    !validBillingWebhookAuth(
      request.headers.get("authorization"),
      process.env.CHARGEBEE_WEBHOOK_USER,
      process.env.CHARGEBEE_WEBHOOK_PASSWORD,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 131072) return new Response("Too large", { status: 413 });
    const incoming = z
      .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
      .safeParse(JSON.parse(text));
    if (!incoming.success)
      return new Response("Invalid event", { status: 400 });
    // The body is only a notification. Read authoritative event content from Chargebee.
    const verified = event.parse(
      await chargebeeRequest(`events/${encodeURIComponent(incoming.data.id)}`),
    ).event;
    if (verified.id !== incoming.data.id) throw new Error("Event mismatch");
    const resources: Json[] = [];
    for (const kind of [
      "customer",
      "subscription",
      "invoice",
      "credit_note",
    ] as const) {
      const parsed = resource.safeParse(verified.content[kind]);
      if (!parsed.success) continue;
      const r = parsed.data;
      const customer = kind === "customer" ? r.id : r.customer_id;
      if (!customer) continue;
      resources.push({
        kind,
        id: r.id,
        customer_id: customer,
        resource_version: r.resource_version,
        payload: r as Json,
      });
    }
    const { error } = await createServiceClient().rpc("apply_chargebee_event", {
      p_site: chargebeeSite() ?? "",
      p_event_id: verified.id,
      p_event_type: verified.event_type,
      p_resources: resources,
    });
    if (error) throw new Error("Event persistence failed");
    await sendSubscriptionEmail(verified);
    return Response.json({ received: true });
  } catch {
    console.error("[Mill billing] webhook processing failed");
    return new Response("Retry later", { status: 503 });
  }
}
