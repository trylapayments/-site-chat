import { planFromPriceId } from "./plans";
import { z } from "zod";

export const BILLING_GRACE_DAYS = 7;
export const BILLING_RETRY_DAYS = [1, 3, 7] as const;
const invoice = z.object({
  id: z.string(),
  customer_id: z.string(),
  subscription_id: z.string().optional(),
  status: z.string(),
  amount_due: z.number().nonnegative(),
  date: z.number(),
  due_date: z.number().optional(),
  first_invoice: z.boolean().optional(),
  resource_version: z.number().optional(),
  next_retry_at: z.number().optional(),
  currency_code: z.string(),
  recurring: z.boolean().optional(),
  line_items: z
    .array(
      z.object({
        entity_type: z.string().optional(),
        entity_id: z.string().optional(),
        amount: z.number().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});
export type OverdueInvoice = z.infer<typeof invoice>;
export function overdueInvoice(value: unknown) {
  const parsed = invoice.safeParse(value);
  return parsed.success &&
    ["payment_due", "not_paid"].includes(parsed.data.status) &&
    parsed.data.amount_due > 0
    ? parsed.data
    : null;
}
export function invoiceHasBasePlan(value: OverdueInvoice) {
  if (!value.line_items?.length) return value.recurring === true;
  return value.line_items.some(
    (line) =>
      (line.amount ?? 0) > 0 &&
      (line.entity_type === "plan" ||
        line.entity_type === "plan_item_price" ||
        Boolean(line.entity_id && planFromPriceId(line.entity_id))),
  );
}
export function invoiceAddOnIds(value: OverdueInvoice) {
  return [
    ...new Set(
      (value.line_items ?? [])
        .filter(
          (line) =>
            (line.amount ?? 0) > 0 &&
            (line.entity_type === "addon" ||
              line.entity_type === "addon_item_price" ||
              line.entity_type === "charge_item_price" ||
              line.entity_id?.startsWith("mill-ai-")),
        )
        .map(
          (line) => line.entity_id ?? line.description ?? "additional_service",
        ),
    ),
  ];
}
export function billingAddOnDebts(
  values: unknown[],
  customerId: string,
  now = Date.now(),
) {
  return values
    .map(overdueInvoice)
    .filter((i): i is OverdueInvoice =>
      Boolean(
        i &&
        i.customer_id === customerId &&
        (i.due_date ?? i.date) * 1000 <= now &&
        invoiceAddOnIds(i).length,
      ),
    );
}
export function graceDeadline(
  value: Pick<OverdueInvoice, "date" | "due_date">,
) {
  return ((value.due_date ?? value.date) + BILLING_GRACE_DAYS * 86400) * 1000;
}
export function billingDunning(
  values: unknown[],
  subscriptionId: string,
  now = Date.now(),
) {
  const invoices = values
    .map(overdueInvoice)
    .filter((i): i is OverdueInvoice =>
      Boolean(
        i &&
        i.customer_id === subscriptionId &&
        i.subscription_id === subscriptionId &&
        invoiceHasBasePlan(i) &&
        (i.due_date ?? i.date) * 1000 <= now,
      ),
    );
  const oldest = invoices.sort(
    (a, b) => (a.due_date ?? a.date) - (b.due_date ?? b.date),
  )[0];
  if (!oldest) return null;
  const deadline = graceDeadline(oldest);
  return {
    invoice: oldest,
    deadline,
    expired: now >= deadline,
    initialPayment: oldest.first_invoice === true,
  };
}
