import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  customer: null as string | null,
  upsert: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: mock.customer
                  ? { stripe_customer_id: mock.customer }
                  : null,
                error: null,
              }),
          }),
        }),
      }),
      upsert: mock.upsert,
    }),
  }),
}));
import {
  billingConfigured,
  loadBilling,
  ensureCustomer,
  completeCardSetup,
  setDefaultCard,
  createCardSetup,
  downloadInvoice,
  removeCard,
} from "./stripe";
import { formatBillingAmount } from "./format";
describe("workspace billing", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock");
    vi.stubEnv("STRIPE_BILLING_MODE", "test");
    mock.customer = null;
    mock.upsert.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("refuses live keys unless live mode is explicitly selected", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_mock");
    expect(billingConfigured()).toBe(false);
  });
  it("has no fabricated invoices or cards for a new workspace", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await loadBilling("workspace-a")).toMatchObject({
      invoices: [],
      paymentMethods: [],
      customerId: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("queries Stripe only for the server-resolved customer", async () => {
    mock.customer = "cus_A";
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        Response.json(
          _url.includes("/customers/")
            ? {
                name: "Test",
                email: null,
                address: null,
                invoice_settings: { default_payment_method: null },
              }
            : { data: [], has_more: false },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await loadBilling("workspace-a");
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [url] of fetch.mock.calls)
      expect(
        url.includes("customer=cus_A") || url.endsWith("customers/cus_A"),
      ).toBe(true);
  });
  it("creates a test customer with tenant metadata and stable idempotency", async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ id: "cus_New", livemode: false })),
    );
    vi.stubGlobal("fetch", fetch);
    await ensureCustomer("workspace-a", "Mill test", "");
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(
      new URLSearchParams(typeof init.body === "string" ? init.body : "").get(
        "metadata[mill_workspace_id]",
      ),
    ).toBe("workspace-a");
    expect(init.headers).toMatchObject({
      "Idempotency-Key": "mill-customer-test-workspace-a",
    });
    expect(mock.upsert).toHaveBeenCalledWith({
      workspace_id: "workspace-a",
      mode: "test",
      stripe_customer_id: "cus_New",
    });
  });
  it("refuses a setup intent belonging to another customer", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        customer: "cus_Other",
        status: "succeeded",
        payment_method: "pm_Other",
        livemode: false,
        metadata: { mill_workspace_id: "workspace-a" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      completeCardSetup("cus_A", "workspace-a", "seti_Other"),
    ).rejects.toThrow("not complete");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses a card belonging to another workspace", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ customer: "cus_Other", type: "card" }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(setDefaultCard("cus_A", "pm_Other")).rejects.toThrow(
      "does not belong",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses card-only setup without making a payment", async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ client_secret: "setup-secret-mock" })),
    );
    vi.stubGlobal("fetch", fetch);
    await createCardSetup("cus_A", "workspace-a");
    const init = fetch.mock.calls[0]?.[1];
    const params = new URLSearchParams(
      typeof init?.body === "string" ? init.body : "",
    );
    expect(params.get("payment_method_types[]")).toBe("card");
    expect(params.get("customer")).toBe("cus_A");
    expect(params.get("amount")).toBeNull();
  });
  it("refuses another customer's invoice without downloading it", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        customer: "cus_Other",
        number: "INV-1",
        invoice_pdf: "https://pay.stripe.com/invoice/test.pdf",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(downloadInvoice("cus_A", "in_Other")).rejects.toThrow(
      "unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("changes an existing subscription override before making the card default", async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        Response.json(
          _url.includes("payment_methods/")
            ? { customer: "cus_A", type: "card" }
            : _url.includes("subscriptions?")
              ? {
                  data: [{ id: "sub_A", customer: "cus_A", status: "active" }],
                  has_more: false,
                }
              : {},
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await setDefaultCard("cus_A", "pm_New");
    const update = fetch.mock.calls.find(([url]) =>
      url.endsWith("subscriptions/sub_A"),
    );
    expect(
      new URLSearchParams(
        typeof update?.[1]?.body === "string" ? update[1].body : "",
      ).get("default_payment_method"),
    ).toBe("pm_New");
    expect(fetch.mock.calls.at(-1)?.[0]).toContain("customers/cus_A");
  });
  it("prevents removal of a card still used by a subscription", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        Response.json(
          url.includes("payment_methods/")
            ? { customer: "cus_A", type: "card" }
            : url.includes("subscriptions?")
              ? { data: [{ status: "active", default_payment_method: "pm_A" }] }
              : { invoice_settings: { default_payment_method: "pm_A" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(removeCard("cus_A", "pm_A")).rejects.toThrow("Choose another");
    expect(fetch.mock.calls.some(([url]) => url.includes("detach"))).toBe(
      false,
    );
  });
  it("downloads only the owned invoice PDF without forwarding API credentials", async () => {
    const fetch = vi.fn((url: string | URL, _init?: RequestInit) =>
      Promise.resolve(
        String(url).includes("api.stripe.com")
          ? Response.json({
              customer: "cus_A",
              number: "INV/1",
              invoice_pdf: "https://pay.stripe.com/invoice/test.pdf",
            })
          : new Response("%PDF-test", {
              headers: { "Content-Type": "application/pdf" },
            }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await downloadInvoice("cus_A", "in_A");
    expect(result.filename).toBe("INV_1.pdf");
    expect(fetch.mock.calls[1]?.[1]?.headers).toBeUndefined();
    expect(result.bytes.byteLength).toBe(9);
  });
  it("formats invoice currencies correctly", () => {
    expect(formatBillingAmount(2499, "usd")).toBe("$24.99");
    expect(formatBillingAmount(500, "jpy")).toContain("500");
    expect(formatBillingAmount(500, "isk")).toContain("5");
  });
});
