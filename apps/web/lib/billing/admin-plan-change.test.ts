import { paidPlanChangeTiming } from "./plans";
import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  retrieve: vi.fn(),
  store: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("./chargebee", () => ({ chargebeeRequest: mocks.request }));
vi.mock("./subscriptions", async () => ({
  checkoutEnabled: () => true,
  retrieveMillSubscription: mocks.retrieve,
  storeMillSubscription: mocks.store,
  validatePrice: mocks.validate,
  millSubscriptionSchema: (await import("zod")).z
    .object({
      id: (await import("zod")).z.string(),
      customer_id: (await import("zod")).z.string(),
    })
    .passthrough(),
}));
import {
  estimateAdminPlanChange,
  executeAdminPlanChange,
} from "./admin-plan-change";
const current = {
  id: "mill_a",
  customer_id: "mill_a",
  status: "active",
  resource_version: 123,
  current_term_end: 2000000000,
  subscription_items: [{ item_price_id: "mill-essential-usd-monthly" }],
};
describe("Administrative paid plan changes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.retrieve.mockResolvedValue(current);
  });
  it("automatically upgrades now and downgrades at renewal", () => {
    expect(paidPlanChangeTiming("essential", "month", "growth", "month")).toBe(
      "now",
    );
    expect(paidPlanChangeTiming("business", "month", "growth", "month")).toBe(
      "renewal",
    );
    expect(paidPlanChangeTiming("essential", "year", "business", "month")).toBe(
      "now",
    );
    expect(paidPlanChangeTiming("growth", "year", "growth", "month")).toBe(
      "renewal",
    );
  });
  it("rejects an immediate downgrade even if the caller requests one", async () => {
    await expect(
      estimateAdminPlanChange("a", "starter", "month", "now"),
    ).rejects.toThrow("Downgrades apply at renewal");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("estimates the exact immediate proration and separates credits from amount due", async () => {
    mocks.request.mockResolvedValue({
      estimate: {
        invoice_estimate: {
          amount_due: 1900,
          total: 4000,
          currency_code: "USD",
        },
        credit_note_estimates: [{ total: 2100, currency_code: "USD" }],
      },
    });
    const estimate = await estimateAdminPlanChange(
      "a",
      "growth",
      "month",
      "now",
    );
    expect(estimate.dueNow).toBe(1900);
    expect(estimate.credit).toBe(2100);
    const params = mocks.request.mock.calls[0]?.[1] as URLSearchParams;
    expect(params.get("subscription[id]")).toBe("mill_a");
    expect(params.get("prorate")).toBe("true");
    expect(params.get("end_of_term")).toBe("false");
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("uses renewal estimates without generating an immediate invoice", async () => {
    mocks.retrieve.mockResolvedValue({
      ...current,
      subscription_items: [{ item_price_id: "mill-business-usd-monthly" }],
    });
    mocks.request.mockResolvedValue({
      estimate: {
        next_invoice_estimate: {
          amount_due: 8900,
          total: 8900,
          currency_code: "USD",
        },
      },
    });
    const e = await estimateAdminPlanChange("a", "growth", "month", "renewal");
    expect(e.dueNow).toBe(0);
    expect(e.nextTotal).toBe(8900);
    expect(e.effectiveAt).toBe(2000000000);
    expect(
      (mocks.request.mock.calls[0]?.[1] as URLSearchParams).get("end_of_term"),
    ).toBe("true");
  });
  it("rejects an outdated confirmation before changing the subscription", async () => {
    await expect(
      executeAdminPlanChange("a", "growth", "month", "now", 122),
    ).rejects.toThrow("subscription changed");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects a scheduled cancellation before estimating a new plan", async () => {
    mocks.retrieve.mockResolvedValue({ ...current, status: "non_renewing" });
    await expect(
      estimateAdminPlanChange("a", "growth", "month", "now"),
    ).rejects.toThrow("Restore renewal");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
