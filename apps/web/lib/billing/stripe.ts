import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
export function billingMode() {
  return process.env.STRIPE_BILLING_MODE === "live" ? "live" : "test";
}
export function billingConfigured() {
  const key = process.env.STRIPE_SECRET_KEY;
  return Boolean(
    key && key.startsWith(billingMode() === "test" ? "sk_test_" : "sk_live_"),
  );
}
async function request(
  path: string,
  params?: URLSearchParams,
  idempotencyKey?: string,
): Promise<unknown> {
  if (!billingConfigured()) throw new Error("Billing is not activated yet.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY ?? ""}`,
      ...(params
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: params?.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error("Billing could not be reached. Please try again.");
  return response.json() as Promise<unknown>;
}
export async function workspaceCustomer(workspaceId: string) {
  const { data, error } = await createServiceClient()
    .from("workspace_billing_accounts")
    .select("stripe_customer_id")
    .eq("workspace_id", workspaceId)
    .eq("mode", billingMode())
    .maybeSingle();
  if (error) throw new Error("Unable to load billing account.");
  return data?.stripe_customer_id ?? null;
}
const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  created: z.number(),
  total: z.number(),
  currency: z.string(),
  status: z.string().nullable(),
  invoice_pdf: z.string().url().nullable(),
  hosted_invoice_url: z.string().url().nullable(),
});
const methodSchema = z.object({
  id: z.string(),
  type: z.string(),
  card: z
    .object({
      brand: z.string(),
      last4: z.string(),
      exp_month: z.number(),
      exp_year: z.number(),
    })
    .optional(),
});
const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  current_period_end: z.number().optional(),
  cancel_at_period_end: z.boolean(),
  items: z.object({
    data: z.array(
      z.object({
        quantity: z.number().nullable().optional(),
        current_period_end: z.number().optional(),
        price: z.object({
          unit_amount: z.number().nullable(),
          currency: z.string(),
          recurring: z
            .object({ interval: z.string(), interval_count: z.number() })
            .nullable(),
          product: z.union([z.string(), z.object({ name: z.string() })]),
        }),
      }),
    ),
  }),
});
export async function loadBilling(workspaceId: string) {
  const customerId = await workspaceCustomer(workspaceId);
  if (!billingConfigured() || !customerId)
    return {
      connected: billingConfigured(),
      customerId,
      subscriptions: [],
      invoices: [],
      paymentMethods: [],
      hasMoreInvoices: false,
    };
  const q = new URLSearchParams({ customer: customerId, limit: "100" });
  const [subscriptions, invoices, methods] = await Promise.all([
    request(
      `subscriptions?${q}&status=all&expand[]=data.items.data.price.product`,
    ),
    request(`invoices?${q}`),
    request(`payment_methods?${q}`),
  ]);
  const invoiceResult = z
    .object({ data: z.array(invoiceSchema), has_more: z.boolean() })
    .parse(invoices);
  return {
    connected: true,
    customerId,
    subscriptions: z
      .object({ data: z.array(subscriptionSchema) })
      .parse(subscriptions).data,
    invoices: invoiceResult.data,
    paymentMethods: z.object({ data: z.array(methodSchema) }).parse(methods)
      .data,
    hasMoreInvoices: invoiceResult.has_more,
  };
}
export async function ensureCustomer(
  workspaceId: string,
  name: string,
  email: string,
) {
  const existing = await workspaceCustomer(workspaceId);
  if (existing) return existing;
  const params = new URLSearchParams({
    name,
    "metadata[mill_workspace_id]": workspaceId,
    "metadata[mill_billing_mode]": billingMode(),
  });
  if (email) params.set("email", email);
  const customer = z
    .object({
      id: z.string().regex(/^cus_[A-Za-z0-9]+$/),
      livemode: z.boolean(),
    })
    .parse(
      await request(
        "customers",
        params,
        `mill-customer-${billingMode()}-${workspaceId}`,
      ),
    );
  if (customer.livemode !== (billingMode() === "live"))
    throw new Error("Billing environment mismatch.");
  const { error } = await createServiceClient()
    .from("workspace_billing_accounts")
    .upsert({
      workspace_id: workspaceId,
      mode: billingMode(),
      stripe_customer_id: customer.id,
    });
  if (error) throw new Error("Unable to save billing account.");
  return customer.id;
}
async function portalConfiguration() {
  if (process.env.STRIPE_PORTAL_CONFIGURATION_ID)
    return process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  const list = z
    .object({
      data: z.array(
        z.object({
          id: z.string(),
          active: z.boolean(),
          metadata: z.record(z.string()).optional(),
        }),
      ),
    })
    .parse(await request("billing_portal/configurations?limit=100"));
  const existing = list.data.find(
    (c) => c.active && c.metadata?.mill_portal === "1",
  );
  if (existing) return existing.id;
  const params = new URLSearchParams({
    "business_profile[headline]": "Manage your Mill billing",
    "features[payment_method_update][enabled]": "true",
    "features[invoice_history][enabled]": "true",
    "features[customer_update][enabled]": "true",
    "features[customer_update][allowed_updates][]": "address",
    "metadata[mill_portal]": "1",
  });
  params.append("features[customer_update][allowed_updates][]", "email");
  params.append("features[customer_update][allowed_updates][]", "name");
  params.append("features[customer_update][allowed_updates][]", "tax_id");
  return z
    .object({ id: z.string() })
    .parse(
      await request(
        "billing_portal/configurations",
        params,
        `mill-portal-config-${billingMode()}-v1`,
      ),
    ).id;
}
export async function createBillingPortal(customer: string, returnUrl: string) {
  const result = z.object({ url: z.string().url() }).parse(
    await request(
      "billing_portal/sessions",
      new URLSearchParams({
        customer,
        return_url: returnUrl,
        configuration: await portalConfiguration(),
      }),
    ),
  );
  if (
    new URL(result.url).hostname !== "billing.stripe.com" ||
    new URL(result.url).protocol !== "https:"
  )
    throw new Error("Invalid billing portal.");
  return result.url;
}
