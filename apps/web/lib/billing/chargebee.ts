import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { z } from "zod";
import type { Json } from "@site-chat/shared";
import { billingDetailsSchema } from "./schema";
import { BillingSetupError, BillingValidationError } from "./stripe";
import type { loadBilling as stripeLoadBilling } from "./stripe";
export function chargebeeSite() {
  const site = process.env.CHARGEBEE_SITE ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site)) return null;
  if (process.env.CHARGEBEE_MODE !== "live" && !site.endsWith("-test"))
    return null;
  return site;
}
export function chargebeeConfigured() {
  return Boolean(chargebeeSite() && process.env.CHARGEBEE_API_KEY);
}
export function chargebeeBrowserConfig() {
  const site = chargebeeSite();
  const publishableKey = process.env.NEXT_PUBLIC_CHARGEBEE_PUBLISHABLE_KEY;
  return site && publishableKey ? { site, publishableKey } : null;
}
export async function chargebeeRequest(
  path: string,
  params?: URLSearchParams,
  idempotency?: string,
): Promise<unknown> {
  const site = chargebeeSite();
  if (!site || !chargebeeConfigured())
    throw new BillingSetupError("configuration", "not_configured");
  const response = await fetch(`https://${site}.chargebee.com/api/v2/${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.CHARGEBEE_API_KEY ?? ""}:`).toString("base64")}`,
      ...(params
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
      ...(idempotency ? { "chargebee-idempotency-key": idempotency } : {}),
    },
    body: params?.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new BillingSetupError("chargebee_api", String(response.status));
  return response.json() as Promise<unknown>;
}
const customerSchema = z.object({
  id: z.string(),
  company: z.string().optional(),
  email: z.string().optional(),
  primary_payment_source_id: z.string().optional(),
  billing_address: z
    .object({
      company: z.string().optional(),
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
});
const invoiceSchema = z
  .object({
    id: z.string(),
    customer_id: z.string(),
    date: z.number(),
    total: z.number(),
    currency_code: z.string(),
    status: z.string(),
  })
  .passthrough();
const subscriptionSchema = z
  .object({
    id: z.string(),
    customer_id: z.string(),
    status: z.string(),
    current_term_end: z.number().optional(),
    billing_period: z.number().optional(),
    billing_period_unit: z.string().optional(),
    subscription_items: z
      .array(
        z.object({
          item_price_id: z.string(),
          unit_price: z.number().optional(),
          quantity: z.number().optional(),
        }),
      )
      .optional(),
    currency_code: z.string().optional(),
  })
  .passthrough();
const paymentSourceSchema = z
  .object({
    id: z.string(),
    customer_id: z.string(),
    type: z.string(),
    status: z.string(),
    deleted: z.boolean().optional(),
    card: z
      .object({
        brand: z.string(),
        last4: z.string(),
        expiry_month: z.number(),
        expiry_year: z.number(),
      })
      .optional(),
  })
  .passthrough();
async function account(workspaceId: string) {
  const site = chargebeeSite();
  if (!site) return null;
  const { data, error } = await createServiceClient()
    .from("workspace_chargebee_accounts")
    .select("customer_id,snapshot,synced_at")
    .eq("workspace_id", workspaceId)
    .eq("site", site)
    .maybeSingle();
  if (error) throw new BillingSetupError("chargebee_mapping", error.code);
  return data;
}
export async function chargebeeCustomer(workspaceId: string) {
  return (await account(workspaceId))?.customer_id ?? null;
}
export async function ensureChargebeeCustomer(
  workspaceId: string,
  name: string,
  email: string,
) {
  const existing = await chargebeeCustomer(workspaceId);
  if (existing) return existing;
  const id = `mill_${workspaceId}`;
  const site = chargebeeSite();
  if (!site) throw new Error("Billing is not connected.");
  let raw: unknown;
  try {
    raw = await chargebeeRequest(`customers/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!(error instanceof BillingSetupError) || error.code !== "404")
      throw error;
    raw = await chargebeeRequest(
      "customers",
      new URLSearchParams({
        id,
        company: name,
        ...(email ? { email } : {}),
        auto_collection: "on",
      }),
      `mill-customer-${id}`,
    );
  }
  const { customer } = z.object({ customer: customerSchema }).parse(raw);
  if (customer.id !== id) throw new Error("Customer mismatch.");
  const { error } = await createServiceClient()
    .from("workspace_chargebee_accounts")
    .upsert({ workspace_id: workspaceId, site, customer_id: id });
  if (error) throw new BillingSetupError("chargebee_mapping", error.code);
  return id;
}
export async function loadChargebeeBilling(
  workspaceId: string,
): Promise<
  Awaited<ReturnType<typeof stripeLoadBilling>> & { cached?: boolean }
> {
  const record = await account(workspaceId);
  const empty = {
    connected: chargebeeConfigured(),
    customerId: record?.customer_id ?? null,
    subscriptions: [],
    invoices: [],
    paymentMethods: [],
    hasMoreInvoices: false,
    customerDetails: null,
    defaultPaymentMethod: null,
  };
  if (!chargebeeConfigured() || !record) return empty;
  try {
    const q = new URLSearchParams({
      "customer_id[is]": record.customer_id,
      limit: "100",
    });
    const [customerRaw, subsRaw, invoicesRaw, sourcesRaw] = await Promise.all([
      chargebeeRequest(`customers/${encodeURIComponent(record.customer_id)}`),
      chargebeeRequest(`subscriptions?${q}`),
      chargebeeRequest(`invoices?${q}`),
      chargebeeRequest(`payment_sources?${q}`),
    ]);
    const customer = z
      .object({ customer: customerSchema })
      .parse(customerRaw).customer;
    const subscriptions = z
      .object({ list: z.array(z.object({ subscription: subscriptionSchema })) })
      .parse(subsRaw)
      .list.map((r) => r.subscription);
    const invoices = z
      .object({
        list: z.array(z.object({ invoice: invoiceSchema })),
        next_offset: z.string().optional(),
      })
      .parse(invoicesRaw);
    const sources = z
      .object({
        list: z.array(z.object({ payment_source: paymentSourceSchema })),
      })
      .parse(sourcesRaw)
      .list.map((r) => r.payment_source);
    if (
      customer.id !== record.customer_id ||
      [
        ...subscriptions,
        ...invoices.list.map((r) => r.invoice),
        ...sources,
      ].some((r) => r.customer_id !== record.customer_id)
    )
      throw new Error("Billing customer mismatch.");
    const snapshot = {
      customer,
      subscriptions,
      invoices: invoices.list.map((r) => r.invoice),
      sources,
      hasMore: Boolean(invoices.next_offset),
    };
    const { error } = await createServiceClient()
      .from("workspace_chargebee_accounts")
      .update({
        snapshot: JSON.parse(JSON.stringify(snapshot)) as Json,
        synced_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("site", chargebeeSite() ?? "");
    if (error) throw new BillingSetupError("chargebee_cache", error.code);
    return normalizeSnapshot(snapshot, record.customer_id);
  } catch (error) {
    const cached = snapshotSchema.safeParse(record.snapshot);
    if (cached.success)
      return {
        ...normalizeSnapshot(cached.data, record.customer_id),
        cached: true,
      };
    throw error;
  }
}
const snapshotSchema = z.object({
  customer: customerSchema,
  subscriptions: z.array(subscriptionSchema),
  invoices: z.array(invoiceSchema),
  sources: z.array(paymentSourceSchema),
  hasMore: z.boolean(),
});
function normalizeSnapshot(
  input: unknown,
  customerId: string,
): Awaited<ReturnType<typeof stripeLoadBilling>> {
  const data = snapshotSchema.parse(input);
  if (
    data.customer.id !== customerId ||
    [...data.subscriptions, ...data.invoices, ...data.sources].some(
      (resource) => resource.customer_id !== customerId,
    )
  )
    throw new Error("Billing customer mismatch.");
  const a = data.customer.billing_address;
  return {
    connected: true,
    customerId,
    subscriptions: data.subscriptions.map((s) => ({
      id: s.id,
      status: s.status === "in_trial" ? "trialing" : s.status,
      current_period_end: s.current_term_end,
      cancel_at_period_end: s.status === "non_renewing",
      items: {
        data: (s.subscription_items ?? []).map((i) => ({
          quantity: i.quantity,
          price: {
            unit_amount: i.unit_price ?? null,
            currency: s.currency_code ?? "USD",
            product: { name: i.item_price_id },
            recurring: {
              interval: s.billing_period_unit ?? "month",
              interval_count: s.billing_period ?? 1,
            },
          },
        })),
      },
    })),
    invoices: data.invoices.map((i) => ({
      id: i.id,
      number: i.id,
      created: i.date,
      total: i.total,
      currency: i.currency_code,
      status: i.status,
      invoice_pdf: i.status !== "pending" ? "archivable" : null,
      hosted_invoice_url: null,
    })),
    paymentMethods: data.sources
      .filter((s) => !s.deleted && s.type === "card")
      .map((s) => ({
        id: s.id,
        type: s.type,
        card: s.card
          ? {
              brand: s.card.brand,
              last4: s.card.last4,
              exp_month: s.card.expiry_month,
              exp_year: s.card.expiry_year,
            }
          : undefined,
      })),
    hasMoreInvoices: data.hasMore,
    customerDetails: {
      name: a?.company ?? data.customer.company ?? null,
      email: data.customer.email ?? null,
      address: a
        ? {
            line1: a.line1 ?? null,
            line2: a.line2 ?? null,
            city: a.city ?? null,
            state: a.state ?? null,
            postal_code: a.zip ?? null,
            country: a.country ?? null,
          }
        : null,
      invoice_settings: {
        default_payment_method: data.customer.primary_payment_source_id ?? null,
      },
    },
    defaultPaymentMethod: data.customer.primary_payment_source_id ?? null,
  };
}
export async function startChargebeeCardSetup(
  workspaceId: string,
  customer: string,
) {
  const intent = z
    .object({
      payment_intent: z.object({
        id: z.string(),
        expires_at: z.number(),
        amount: z.number(),
        customer_id: z.string().optional(),
      }),
    })
    .parse(
      await chargebeeRequest(
        "payment_intents",
        new URLSearchParams({
          customer_id: customer,
          amount: "0",
          currency_code: "USD",
          payment_method_type: "card",
          ...(process.env.CHARGEBEE_GATEWAY_ACCOUNT_ID
            ? { gateway_account_id: process.env.CHARGEBEE_GATEWAY_ACCOUNT_ID }
            : {}),
        }),
      ),
    ).payment_intent;
  if (intent.amount !== 0 || intent.customer_id !== customer)
    throw new Error("Card setup customer mismatch.");
  const { error } = await createServiceClient()
    .from("billing_card_setups")
    .insert({
      site: chargebeeSite() ?? "",
      intent_id: intent.id,
      workspace_id: workspaceId,
      customer_id: customer,
      expires_at: new Date(intent.expires_at * 1000).toISOString(),
    });
  if (error) throw new BillingSetupError("chargebee_card_setup", error.code);
  return { id: intent.id };
}
export async function completeChargebeeCardSetup(
  workspaceId: string,
  customer: string,
  intentId: string,
) {
  const service = createServiceClient();
  const { data, error } = await service
    .from("billing_card_setups")
    .select("customer_id,expires_at")
    .eq("site", chargebeeSite() ?? "")
    .eq("workspace_id", workspaceId)
    .eq("intent_id", intentId)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.customer_id !== customer ||
    Date.parse(data.expires_at) < Date.now()
  )
    throw new Error("Card setup unavailable.");
  const intent = z
    .object({
      payment_intent: z.object({
        id: z.string(),
        status: z.string(),
        customer_id: z.string().optional(),
        amount: z.number(),
      }),
    })
    .parse(
      await chargebeeRequest(`payment_intents/${encodeURIComponent(intentId)}`),
    ).payment_intent;
  if (
    intent.id !== intentId ||
    intent.customer_id !== customer ||
    intent.amount !== 0 ||
    intent.status !== "authorized"
  )
    throw new Error("Card setup not authorized.");
  const source = z.object({ payment_source: paymentSourceSchema }).parse(
    await chargebeeRequest(
      "payment_sources/create_using_payment_intent",
      new URLSearchParams({
        customer_id: customer,
        "payment_intent[id]": intentId,
      }),
      `mill-card-${intentId}`,
    ),
  ).payment_source;
  await setChargebeeDefaultCard(customer, source.id);
}
async function ownedSource(customer: string, id: string) {
  const source = z
    .object({ payment_source: paymentSourceSchema })
    .parse(
      await chargebeeRequest(`payment_sources/${encodeURIComponent(id)}`),
    ).payment_source;
  if (source.customer_id !== customer || source.deleted)
    throw new Error("Card does not belong to this workspace.");
  return source;
}
export async function setChargebeeDefaultCard(customer: string, id: string) {
  const source = await ownedSource(customer, id);
  if (!["valid", "expiring"].includes(source.status))
    throw new BillingValidationError("Choose a valid card.");
  await chargebeeRequest(
    `customers/${encodeURIComponent(customer)}/assign_payment_role`,
    new URLSearchParams({ payment_source_id: id, role: "primary" }),
  );
}
export async function removeChargebeeCard(customer: string, id: string) {
  await ownedSource(customer, id);
  const record = z
    .object({ customer: customerSchema })
    .parse(
      await chargebeeRequest(`customers/${encodeURIComponent(customer)}`),
    ).customer;
  if (record.primary_payment_source_id === id)
    throw new BillingValidationError(
      "Choose another default card before removing this card.",
    );
  // The provider also rejects removal of payment sources referenced by subscriptions.
  await chargebeeRequest(
    `payment_sources/${encodeURIComponent(id)}/delete`,
    new URLSearchParams(),
  );
}
export async function saveChargebeeDetails(
  customer: string,
  input: z.infer<typeof billingDetailsSchema>,
) {
  const d = billingDetailsSchema.parse(input);
  const p = new URLSearchParams({
    company: d.name,
    email: d.email,
    "billing_address[company]": d.name,
  });
  for (const [key, value] of Object.entries(d))
    if (!["name", "email"].includes(key))
      p.set(`billing_address[${key === "postal_code" ? "zip" : key}]`, value);
  await chargebeeRequest(`customers/${encodeURIComponent(customer)}`, p);
}
export async function downloadChargebeeInvoice(
  workspaceId: string,
  customer: string,
  invoiceId: string,
) {
  const site = chargebeeSite();
  if (!site || invoiceId.length > 100) throw new Error("Invalid invoice.");
  const path = `${site}/${workspaceId}/${encodeURIComponent(invoiceId)}.pdf`;
  const service = createServiceClient();
  const cached = await service.storage.from("billing-invoices").download(path);
  if (cached.data)
    return {
      bytes: await cached.data.arrayBuffer(),
      filename: `${invoiceId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
    };
  const invoice = z
    .object({ invoice: invoiceSchema })
    .parse(
      await chargebeeRequest(`invoices/${encodeURIComponent(invoiceId)}`),
    ).invoice;
  if (invoice.customer_id !== customer || invoice.status === "pending")
    throw new Error("Invoice unavailable.");
  const { download } = z
    .object({ download: z.object({ download_url: z.string().url() }) })
    .parse(
      await chargebeeRequest(
        `invoices/${encodeURIComponent(invoiceId)}/pdf`,
        new URLSearchParams(),
      ),
    );
  const url = new URL(download.download_url);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname.endsWith(".chargebee.com") ||
      /^[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)
    )
  )
    throw new Error("Invalid PDF location.");
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/pdf")
  )
    throw new Error("Invoice unavailable.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("Invoice too large.");
  const { error } = await service.storage
    .from("billing-invoices")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error && error.message !== "The resource already exists")
    throw new BillingSetupError("invoice_archive", "upload_failed");
  return {
    bytes,
    filename: `${invoiceId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
  };
}
