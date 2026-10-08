import "server-only";
import { millEmailHtml } from "@/lib/email/mill-template";
import {
  BILLING_GRACE_DAYS,
  graceDeadline,
  overdueInvoice,
  invoiceHasBasePlan,
  invoiceAddOnIds,
} from "./dunning";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { chargebeeRequest, chargebeeSite } from "./chargebee";
import { planFromPriceId, millPlanPrice, formatMillPrice } from "./plans";
const supported = new Set([
  "subscription_created",
  "subscription_changed",
  "subscription_changes_scheduled",
  "payment_failed",
  "payment_succeeded",
]);
const subscriptionSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  resource_version: z.number(),
  status: z.string(),
  current_term_end: z.number().optional(),
  subscription_items: z.array(z.object({ item_price_id: z.string() })),
});
export function subscriptionEmailContent(input: {
  eventType: string;
  workspaceName: string;
  slug: string;
  subscription: z.infer<typeof subscriptionSchema>;
  invoice?: unknown;
}) {
  const price = input.subscription.subscription_items[0]?.item_price_id ?? "";
  const plan = planFromPriceId(price);
  if (!plan) throw new Error("Unknown subscription plan");
  const yearly = price.endsWith("annual");
  const planPrice = millPlanPrice(plan.id, yearly ? "year" : "month");
  if (planPrice === null) throw new Error("Unknown price");
  const scheduled = input.eventType === "subscription_changes_scheduled";
  const welcome = input.eventType === "subscription_created";
  const paymentFailed = input.eventType === "payment_failed";
  const recovered = input.eventType === "payment_succeeded";
  const subject = recovered
    ? "Your Mill payment has been received"
    : paymentFailed
      ? "Your Mill payment could not be completed"
      : welcome
        ? "Welcome to Mill — your paid plan is active"
        : scheduled
          ? "Your Mill plan change is scheduled"
          : "Your Mill plan has changed";
  const billingUrl = `https://app.mill.chat/app/${encodeURIComponent(input.slug)}/billing`;
  const lines = [
    recovered
      ? "Your outstanding payment has been received. Thank you — your billing is up to date for this invoice."
      : paymentFailed
        ? "We could not collect your subscription payment. Please check or update your payment method in Mill."
        : welcome
          ? `Thanks for choosing Mill. Your ${plan.name} plan is now active.`
          : scheduled
            ? `Your change to ${plan.name} has been scheduled.`
            : `Your workspace is now on the ${plan.name} plan.`,
    "",
    `Workspace: ${input.workspaceName}`,
    `Plan: ${plan.name}`,
    `Billing: ${formatMillPrice(planPrice)} / ${yearly ? "year" : "month"}`,
  ];
  if (!paymentFailed && input.subscription.current_term_end)
    lines.push(
      `${scheduled ? "Change takes effect" : "Next renewal"}: ${new Date(input.subscription.current_term_end * 1000).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })}`,
    );
  const invoice = z
    .object({
      amount_paid: z.number().optional(),
      amount_due: z.number().optional(),
      credits_applied: z.number().optional(),
      currency_code: z.literal("USD"),
      status: z.string(),
    })
    .safeParse(input.invoice);
  if (invoice.success) {
    if (!paymentFailed && invoice.data.status === "paid")
      lines.push(
        `Payment received: ${formatMillPrice(invoice.data.amount_paid ?? 0)}`,
      );
    else if (invoice.data.amount_due)
      lines.push(`Amount due: ${formatMillPrice(invoice.data.amount_due)}`);
    if (invoice.data.credits_applied)
      lines.push(
        `Credit applied: ${formatMillPrice(invoice.data.credits_applied)}`,
      );
  }
  const overdue = overdueInvoice(input.invoice);
  if (paymentFailed && overdue) {
    if (overdue.next_retry_at)
      lines.push(
        `Next automatic attempt: ${new Date(overdue.next_retry_at * 1000).toLocaleString("en-US", { timeZone: "UTC" })} UTC`,
      );
    if (
      overdue.subscription_id &&
      !overdue.first_invoice &&
      invoiceHasBasePlan(overdue)
    )
      lines.push(
        `Your ${String(BILLING_GRACE_DAYS)}-day payment grace period ends on ${new Date(graceDeadline(overdue)).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Unpaid subscriptions lose chat access after this deadline unless Mill has granted separate access. Your conversations are preserved.`,
      );
    if (!invoiceHasBasePlan(overdue) && invoiceAddOnIds(overdue).length)
      lines.push(
        "Only the unpaid additional services are paused until this invoice is settled. Your base chat service is not affected by this add-on debt.",
      );
    lines.push(
      "If your bank needs approval, please contact the bank or add another card in Mill. We will retry eligible payments automatically.",
    );
  }
  if (scheduled)
    lines.push(
      "No charge is made for this scheduled change now. Your current plan remains active until the change takes effect.",
    );
  lines.push(
    "",
    "Manage your plan and view invoices in Mill:",
    billingUrl,
    "",
    "The Mill team",
  );
  return {
    subject,
    text: lines.join("\n"),
    html: millEmailHtml({
      title: subject,
      paragraphs: lines.filter(
        (l) =>
          l !== billingUrl &&
          l !== "The Mill team" &&
          l !== "Manage your plan and view invoices in Mill:",
      ),
      button: { label: "Open Billing in Mill", href: billingUrl },
    }),
  };
}
export function shouldSendPaymentFailure(invoice: {
  status: string;
  amount_due: number;
}) {
  return (
    ["payment_due", "not_paid"].includes(invoice.status) &&
    invoice.amount_due > 0
  );
}

export async function sendSubscriptionEmail(event: {
  id?: string;
  event_type: string;
  content: Record<string, unknown>;
}) {
  if (!supported.has(event.event_type)) return;
  const paymentFailed = event.event_type === "payment_failed";
  const recovered = event.event_type === "payment_succeeded";
  let subscriptionValue = event.content.subscription;
  if (
    (paymentFailed || recovered) &&
    !subscriptionSchema.safeParse(subscriptionValue).success
  ) {
    const invoiceRef = z
      .object({
        subscription_id: z.string().optional(),
        customer_id: z.string(),
      })
      .safeParse(event.content.invoice);
    if (!invoiceRef.success) return;
    const subscriptionId = invoiceRef.data.subscription_id ??
      (/^mill_[0-9a-f-]{36}$/.test(invoiceRef.data.customer_id)
        ? invoiceRef.data.customer_id : null);
    if (!subscriptionId) return;
    subscriptionValue = z
      .object({ subscription: subscriptionSchema })
      .parse(
        await chargebeeRequest(
          `subscriptions/${encodeURIComponent(subscriptionId)}`,
        ),
      ).subscription;
  }
  const parsed = subscriptionSchema.safeParse(subscriptionValue);
  // An initial payment failure can occur before any subscription is created.
  if ((paymentFailed || recovered) && !parsed.success) return;
  let subscription = subscriptionSchema.parse(subscriptionValue);
  if (!paymentFailed && !recovered && subscription.status !== "active") return;
  let invoice = event.content.invoice;
  if (paymentFailed || recovered) {
    const notificationInvoice = z
      .object({ id: z.string(), customer_id: z.string() })
      .safeParse(invoice);
    if (
      !notificationInvoice.success ||
      notificationInvoice.data.customer_id !== subscription.customer_id
    )
      return;
    const current = z
      .object({
        invoice: z
          .object({
            id: z.string(),
            customer_id: z.string(),
            status: z.string(),
            amount_due: z.number(),
          })
          .passthrough(),
      })
      .parse(
        await chargebeeRequest(
          `invoices/${encodeURIComponent(notificationInvoice.data.id)}`,
        ),
      ).invoice;
    if (
      current.id !== notificationInvoice.data.id ||
      current.customer_id !== subscription.customer_id
    )
      throw new Error("Invoice customer mismatch");
    // Sandbox delivery and retries can arrive after the customer has already paid.
    if (paymentFailed && !shouldSendPaymentFailure(current)) return;
    if (recovered && (current.status !== "paid" || current.amount_due !== 0))
      return;
    invoice = current;
  }
  const site = chargebeeSite();
  if (!site) throw new Error("Billing unavailable");
  const service = createServiceClient();
  const account = await service
    .from("workspace_chargebee_accounts")
    .select("workspace_id")
    .eq("site", site)
    .eq("customer_id", subscription.customer_id)
    .maybeSingle();
  if (account.error) throw new Error("Billing account unavailable");
  if (!account.data) return;
  if (paymentFailed && !event.id)
    throw new Error("Payment event identifier missing");
  const invoiceRef = z.object({ id: z.string() }).safeParse(invoice);
  const failureMarker = invoiceRef.success
    ? `email-invoice-failed-${invoiceRef.data.id}`
    : null;
  if (recovered) {
    if (!failureMarker) return;
    const { data: previous, error: markerError } = await service
      .from("billing_provider_events")
      .select("event_id")
      .eq("site", site)
      .eq("event_id", failureMarker)
      .maybeSingle();
    if (markerError) throw new Error("Email receipt unavailable");
    if (!previous) return;
  }
  const eventKey =
    recovered && invoiceRef.success
      ? `email-payment-recovered-${invoiceRef.data.id}`
      : paymentFailed
        ? `email-payment-failed-${event.id ?? ""}`
        : `email-${event.event_type}-${subscription.id}-${String(subscription.resource_version)}`;
  // Persisted receipts handle later webhook retries; provider idempotency handles concurrent sends.
  const receipt = await service
    .from("billing_provider_events")
    .select("event_id")
    .eq("site", site)
    .eq("event_id", eventKey)
    .maybeSingle();
  if (receipt.error) throw new Error("Email receipt unavailable");
  if (receipt.data) return;
  const workspace = await service
    .from("workspaces")
    .select("name,slug")
    .eq("id", account.data.workspace_id)
    .single();
  if (workspace.error) throw new Error("Workspace unavailable");
  const customer = z
    .object({ email: z.string().email().optional() })
    .safeParse(z.object({ customer: z.unknown() }).parse(
      await chargebeeRequest(`customers/${encodeURIComponent(subscription.customer_id)}`),
    ).customer);
  const recipients = new Set<string>();
  if (customer.success && customer.data.email)
    recipients.add(customer.data.email);
  else {
    const members = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", account.data.workspace_id)
      .eq("role", "owner")
      .eq("status", "active");
    if (members.error) throw new Error("Billing recipients unavailable");
    for (const member of members.data) {
      const { data, error } = await service.auth.admin.getUserById(
        member.user_id,
      );
      if (error) throw new Error("Owner unavailable");
      if (
        data.user.email &&
        z.string().email().safeParse(data.user.email).success
      )
        recipients.add(data.user.email);
    }
  }
  if (!recipients.size) throw new Error("No billing recipient");
  if (event.event_type === "subscription_changes_scheduled") {
    const raw = await chargebeeRequest(
      `subscriptions/${encodeURIComponent(subscription.id)}/retrieve_with_scheduled_changes`,
    );
    const next = z
      .object({ subscription: subscriptionSchema })
      .parse(raw).subscription;
    if (
      next.id !== subscription.id ||
      next.customer_id !== subscription.customer_id
    )
      throw new Error("Subscription mismatch");
    subscription = { ...next, current_term_end: subscription.current_term_end };
  }
  const content = subscriptionEmailContent({
    eventType: event.event_type,
    workspaceName: workspace.data.name,
    slug: workspace.data.slug,
    subscription,
    invoice,
  });
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email unavailable");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": eventKey,
    },
    body: JSON.stringify({
      from:
        process.env.RESEND_FROM_EMAIL ??
        "Mill <notifications@notify.mill.chat>",
      to: [...recipients],
      ...content,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Billing email failed");
  if (paymentFailed && failureMarker) {
    const { error } = await service.from("billing_provider_events").upsert(
      {
        site,
        event_id: failureMarker,
        event_type: "mill_payment_failure_notified",
      },
      { onConflict: "site,event_id", ignoreDuplicates: true },
    );
    if (error) throw new Error("Failure marker persistence failed");
  }
  const saved = await service
    .from("billing_provider_events")
    .upsert(
      { site, event_id: eventKey, event_type: "mill_subscription_email_sent" },
      { onConflict: "site,event_id", ignoreDuplicates: true },
    );
  if (saved.error) throw new Error("Billing email receipt failed");
}
export async function sendSubscriptionEmailForChange(
  subscription: unknown,
  eventType: string,
  invoice?: unknown,
) {
  await sendSubscriptionEmail({
    event_type: eventType,
    content: { subscription, invoice },
  });
}
