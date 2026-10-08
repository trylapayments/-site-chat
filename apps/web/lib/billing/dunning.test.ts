import { describe, it, expect } from "vitest";
import { billingDunning, graceDeadline, billingAddOnDebts } from "./dunning";
import { resolveBillingAccess } from "./access-policy";
const start = Date.parse("2026-10-06T00:00:00Z");
const sub = {
  status: "active",
  priceId: "mill-essential-usd-monthly",
  termEnd: start / 1000 + 30 * 86400,
};
const invoice = {
  id: "inv1",
  customer_id: "mill_w",
  subscription_id: "mill_w",
  date: start / 1000,
  due_date: start / 1000,
  status: "payment_due",
  amount_due: 4900,
  currency_code: "USD",
  first_invoice: false,
  line_items: [
    {
      entity_type: "plan_item_price",
      entity_id: "mill-essential-usd-monthly",
      amount: 4900,
    },
  ],
};
const base = {
  suspended: false,
  legacyPilot: false,
  controls: null,
  subscription: sub,
};
describe("unpaid subscription access", () => {
  it("continues during seven days and pauses exactly at the deadline", () => {
    const deadline = graceDeadline(invoice);
    expect(
      resolveBillingAccess(
        { ...base, dunning: billingDunning([invoice], "mill_w", deadline - 1) },
        deadline - 1,
      ),
    ).toMatchObject({ enabled: true, source: "grace" });
    expect(
      resolveBillingAccess(
        { ...base, dunning: billingDunning([invoice], "mill_w", deadline) },
        deadline,
      ),
    ).toMatchObject({ enabled: false, source: "payment_overdue" });
  });
  it("restores access after payment, ignores void invoices and another tenant", () => {
    const now = start + 8 * 86400000;
    for (const value of [
      { ...invoice, status: "paid", amount_due: 0 },
      { ...invoice, status: "voided" },
      { ...invoice, customer_id: "mill_other" },
    ]) {
      expect(billingDunning([value], "mill_w", now)).toBeNull();
      expect(
        resolveBillingAccess(
          { ...base, dunning: billingDunning([value], "mill_w", now) },
          now,
        ).enabled,
      ).toBe(true);
    }
  });
  it("honours complimentary access and owner suspension", () => {
    const now = start + 8 * 86400000,
      dunning = billingDunning([invoice], "mill_w", now);
    const controls = {
      access_mode: "standard",
      plan_id: "business",
      trial_ends_at: null,
      override_expires_at: null,
    };
    expect(
      resolveBillingAccess({ ...base, controls, dunning }, now),
    ).toMatchObject({ enabled: true, source: "complimentary" });
    expect(
      resolveBillingAccess({ ...base, controls, dunning, suspended: true }, now)
        .enabled,
    ).toBe(false);
  });
  it("does not grant a new paid plan if its first payment failed", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          dunning: billingDunning(
            [{ ...invoice, first_invoice: true }],
            "mill_w",
            start,
          ),
        },
        start,
      ).enabled,
    ).toBe(false);
  });
  it("uses earliest unpaid due date and does not extend grace on retries", () => {
    expect(
      billingDunning(
        [
          {
            ...invoice,
            id: "inv2",
            date: start / 1000 + 86400,
            due_date: start / 1000 + 86400,
          },
          invoice,
        ],
        "mill_w",
        start + 2 * 86400000,
      )?.deadline,
    ).toBe(start + 7 * 86400000);
  });
});

it("add-on debt does not disable the base chat, and clears when paid", () => {
  const addon = {
    ...invoice,
    line_items: [
      {
        entity_type: "addon_item_price",
        entity_id: "mill-ai-100",
        amount: 1000,
      },
    ],
  };
  const now = start + 8 * 86400000;
  expect(billingDunning([addon], "mill_w", now)).toBeNull();
  expect(
    resolveBillingAccess(
      { ...base, dunning: billingDunning([addon], "mill_w", now) },
      now,
    ).enabled,
  ).toBe(true);
  expect(billingAddOnDebts([addon], "mill_w", now)).toHaveLength(1);
  expect(
    billingAddOnDebts(
      [{ ...addon, status: "paid", amount_due: 0 }],
      "mill_w",
      now,
    ),
  ).toHaveLength(0);
});
it("mixed plan and add-on invoices still affect the base service", () => {
  expect(
    billingDunning(
      [
        {
          ...invoice,
          line_items: [
            ...invoice.line_items,
            {
              entity_type: "addon_item_price",
              entity_id: "mill-ai-100",
              amount: 1000,
            },
          ],
        },
      ],
      "mill_w",
      start,
    ),
  ).not.toBeNull();
});
