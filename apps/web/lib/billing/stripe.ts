import { billingDetailsSchema } from "./schema";
import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
export class BillingValidationError extends Error {}
export class BillingSetupError extends Error {
  constructor(
    readonly stage: string,
    readonly code: string,
  ) {
    super("Billing setup failed.");
  }
}
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
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const failure = z
      .object({
        error: z.object({
          code: z
            .string()
            .regex(/^[a-z_]+$/)
            .optional(),
          type: z
            .string()
            .regex(/^[a-z_]+$/)
            .optional(),
        }),
      })
      .safeParse(body);
    throw new BillingSetupError(
      path.split("?")[0] ?? "stripe",
      failure.success
        ? (failure.data.error.code ??
            failure.data.error.type ??
            String(response.status))
        : String(response.status),
    );
  }
  return response.json() as Promise<unknown>;
}
export async function workspaceCustomer(workspaceId: string) {
  const { data, error } = await createServiceClient()
    .from("workspace_billing_accounts")
    .select("stripe_customer_id")
    .eq("workspace_id", workspaceId)
    .eq("mode", billingMode())
    .maybeSingle();
  if (error) throw new BillingSetupError("customer_lookup", error.code);
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
const customerBillingSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z
    .object({
      line1: z.string().nullable(),
      line2: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      postal_code: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable()
    .optional(),
  invoice_settings: z.object({ default_payment_method: z.string().nullable() }),
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
      customerDetails: null,
      defaultPaymentMethod: null,
    };
  const q = new URLSearchParams({ customer: customerId, limit: "100" });
  const [subscriptions, invoices, methods, customer] = await Promise.all([
    request(`subscriptions?${q}&status=all`),
    request(`invoices?${q}`),
    request(`payment_methods?${q}&type=card`),
    request(`customers/${customerId}`),
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
    customerDetails: customerBillingSchema.parse(customer),
    defaultPaymentMethod:
      customerBillingSchema.parse(customer).invoice_settings
        .default_payment_method,
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
  if (error) throw new BillingSetupError("customer_save", error.code);
  return customer.id;
}

export function stripePublishableKey() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return key?.startsWith(billingMode() === "test" ? "pk_test_" : "pk_live_")
    ? key
    : null;
}
export async function createCardSetup(customer: string, workspaceId: string) {
  return z.object({ client_secret: z.string().min(1) }).parse(
    await request(
      "setup_intents",
      new URLSearchParams({
        customer,
        "payment_method_types[]": "card",
        usage: "off_session",
        "metadata[mill_workspace_id]": workspaceId,
      }),
    ),
  ).client_secret;
}
export async function completeCardSetup(
  customer: string,
  workspaceId: string,
  setupId: string,
) {
  if (!/^seti_[A-Za-z0-9]+$/.test(setupId))
    throw new Error("Invalid card setup.");
  const setup = z
    .object({
      customer: z.string(),
      status: z.string(),
      livemode: z.boolean(),
      payment_method: z.string().nullable(),
      metadata: z.record(z.string()),
    })
    .parse(await request(`setup_intents/${setupId}`));
  if (
    setup.customer !== customer ||
    setup.metadata.mill_workspace_id !== workspaceId ||
    setup.livemode !== (billingMode() === "live") ||
    setup.status !== "succeeded" ||
    !setup.payment_method
  )
    throw new Error("Card setup is not complete.");
  await setDefaultCard(customer, setup.payment_method);
}
async function ownedCard(customer: string, methodId: string) {
  if (!/^pm_[A-Za-z0-9]+$/.test(methodId))
    throw new Error("Invalid payment method.");
  const method = z
    .object({ customer: z.string().nullable(), type: z.string() })
    .parse(await request(`payment_methods/${methodId}`));
  if (method.customer !== customer || method.type !== "card")
    throw new Error("Payment method does not belong to this workspace.");
}
export async function setDefaultCard(customer: string, methodId: string) {
  await ownedCard(customer, methodId);
  // A subscription-level override otherwise keeps charging the previous card.
  const subscriptions = z
    .object({
      data: z.array(
        z.object({
          id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
          customer: z.string(),
          status: z.string(),
        }),
      ),
      has_more: z.boolean(),
    })
    .parse(
      await request(`subscriptions?customer=${customer}&status=all&limit=100`),
    );
  if (subscriptions.has_more)
    throw new BillingValidationError(
      "Please contact Mill to update this account's payment method.",
    );
  for (const subscription of subscriptions.data) {
    if (subscription.customer !== customer)
      throw new Error("Subscription does not belong to this workspace.");
    if (
      ["active", "trialing", "past_due", "unpaid", "paused"].includes(
        subscription.status,
      )
    )
      await request(
        `subscriptions/${subscription.id}`,
        new URLSearchParams({ default_payment_method: methodId }),
      );
  }
  await request(
    `customers/${customer}`,
    new URLSearchParams({
      "invoice_settings[default_payment_method]": methodId,
    }),
  );
}
export async function removeCard(customer: string, methodId: string) {
  await ownedCard(customer, methodId);
  const record = customerBillingSchema.parse(
    await request(`customers/${customer}`),
  );
  const subs = z
    .object({
      data: z.array(
        z.object({
          status: z.string(),
          default_payment_method: z.string().nullable(),
        }),
      ),
    })
    .parse(
      await request(`subscriptions?customer=${customer}&status=all&limit=100`),
    );
  if (
    subs.data.some(
      (s) =>
        ["active", "trialing", "past_due", "unpaid", "paused"].includes(
          s.status,
        ) &&
        (s.default_payment_method === methodId ||
          (!s.default_payment_method &&
            record.invoice_settings.default_payment_method === methodId)),
    )
  )
    throw new BillingValidationError(
      "This card is used by your subscription. Choose another default card first.",
    );
  if (record.invoice_settings.default_payment_method === methodId)
    await request(
      `customers/${customer}`,
      new URLSearchParams({ "invoice_settings[default_payment_method]": "" }),
    );
  await request(`payment_methods/${methodId}/detach`, new URLSearchParams());
}
export async function saveBillingDetails(
  customer: string,
  input: z.infer<typeof billingDetailsSchema>,
) {
  const details = billingDetailsSchema.parse(input);
  const params = new URLSearchParams({
    name: details.name,
    email: details.email,
  });
  for (const field of [
    "line1",
    "line2",
    "city",
    "state",
    "postal_code",
    "country",
  ] as const)
    params.set(`address[${field}]`, details[field]);
  await request(`customers/${customer}`, params);
}
export async function downloadInvoice(customer: string, invoiceId: string) {
  if (!/^in_[A-Za-z0-9]+$/.test(invoiceId)) throw new Error("Invalid invoice.");
  const invoice = z
    .object({
      customer: z.string(),
      number: z.string().nullable(),
      invoice_pdf: z.string().url().nullable(),
    })
    .parse(await request(`invoices/${invoiceId}`));
  if (invoice.customer !== customer || !invoice.invoice_pdf)
    throw new Error("Invoice unavailable.");
  const url = new URL(invoice.invoice_pdf);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
  )
    throw new Error("Invalid invoice location.");
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/pdf")
  )
    throw new Error("Invoice unavailable.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("Invoice is too large.");
  return {
    bytes,
    filename: `${(invoice.number ?? invoiceId).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
  };
}
