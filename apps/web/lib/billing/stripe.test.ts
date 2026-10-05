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
  createBillingPortal,
} from "./stripe";
import { formatBillingAmount } from "./format";
describe("workspace billing", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock");
    vi.stubEnv("STRIPE_BILLING_MODE", "test");
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_mock");
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
      Promise.resolve(Response.json({ data: [], has_more: false })),
    );
    vi.stubGlobal("fetch", fetch);
    await loadBilling("workspace-a");
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url] of fetch.mock.calls)
      expect(url).toContain("customer=cus_A");
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
  it("rejects an unexpected or insecure redirect destination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init?: RequestInit) =>
        Promise.resolve(
          Response.json({ url: "http://billing.stripe.com/session" }),
        ),
      ),
    );
    await expect(
      createBillingPortal("cus_A", "https://app.mill.chat/billing"),
    ).rejects.toThrow("Invalid billing portal");
  });
  it("formats invoice currencies correctly", () => {
    expect(formatBillingAmount(2499, "usd")).toBe("$24.99");
    expect(formatBillingAmount(500, "jpy")).toContain("500");
    expect(formatBillingAmount(500, "isk")).toContain("5");
  });
});
