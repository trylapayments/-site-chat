import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  ensureCustomer: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("./chargebee", () => ({
  chargebeeRequest: mocks.request,
  chargebeeSite: () => "millchat-test",
  ensureChargebeeCustomer: mocks.ensureCustomer,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));
import {
  retrieveMillSubscription,
  subscribeToMill,
  manageMillSubscription,
  storeMillSubscription,
} from "./subscriptions";
const subscription = {
  id: "mill_workspace-a",
  customer_id: "mill_workspace-a",
  status: "active",
  resource_version: 123,
  current_term_end: 2000000000,
  subscription_items: [
    { item_price_id: "mill-essential-usd-monthly", quantity: 1 },
  ],
};
const price = {
  id: "mill-essential-usd-annual",
  price: 49000,
  currency_code: "USD",
  period: 1,
  period_unit: "year",
  status: "active",
};
describe("Mill subscription isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CHARGEBEE_CHECKOUT_ENABLED", "true");
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.ensureCustomer.mockResolvedValue("mill_workspace-a");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("rejects a provider subscription belonging to another customer", async () => {
    mocks.request.mockResolvedValue({
      subscription: { ...subscription, customer_id: "mill_workspace-b" },
    });
    await expect(retrieveMillSubscription("workspace-a")).rejects.toThrow(
      "customer mismatch",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a second subscription before making a charge", async () => {
    mocks.request
      .mockResolvedValueOnce({ item_price: price })
      .mockResolvedValueOnce({ subscription });
    await expect(
      subscribeToMill({
        workspaceId: "workspace-a",
        name: "A",
        email: "a@example.com",
        planId: "essential",
        interval: "year",
      }),
    ).rejects.toThrow("already has a subscription");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an altered annual price before creating a customer or subscription", async () => {
    mocks.request.mockResolvedValue({ item_price: { ...price, price: 4900 } });
    await expect(
      subscribeToMill({
        workspaceId: "workspace-a",
        name: "A",
        email: "a@example.com",
        planId: "essential",
        interval: "year",
      }),
    ).rejects.toThrow("No payment was started");
    expect(mocks.ensureCustomer).not.toHaveBeenCalled();
  });
  it("uses the agreed CHAT suffix and exact annual price when creating a subscription", async () => {
    mocks.request
      .mockResolvedValueOnce({ item_price: price })
      .mockRejectedValueOnce(
        Object.assign(new Error("Missing"), { code: "404" }),
      )
      .mockResolvedValueOnce({
        customer: { primary_payment_source_id: "test-card" },
      })
      .mockResolvedValueOnce({ subscription });
    await subscribeToMill({
      workspaceId: "workspace-a",
      name: "A",
      email: "a@example.com",
      planId: "essential",
      interval: "year",
    });
    const params = mocks.request.mock.calls[3]?.[1] as URLSearchParams;
    expect(params.get("statement_descriptor[descriptor]")).toBe("CHAT");
    expect(params.get("subscription_items[item_price_id][0]")).toBe(
      "mill-essential-usd-annual",
    );
    expect(params.get("trial_end")).toBe("0");
  });
  it("cancels only at term end and uses a stable idempotency key", async () => {
    mocks.request
      .mockResolvedValueOnce({ subscription })
      .mockResolvedValueOnce({
        subscription: {
          ...subscription,
          status: "non_renewing",
          resource_version: 124,
        },
      });
    await manageMillSubscription("workspace-a", "cancel");
    const [path, params, key] = mocks.request.mock.calls[1] as [
      string,
      URLSearchParams,
      string,
    ];
    expect(path).toBe("subscriptions/mill_workspace-a/cancel_for_items");
    expect(params.get("end_of_term")).toBe("true");
    expect(key).toBe("mill-cancel-mill_workspace-a-123--month");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("refuses to store another workspace's subscription", async () => {
    await expect(
      storeMillSubscription("workspace-b", subscription),
    ).rejects.toThrow("customer mismatch");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
