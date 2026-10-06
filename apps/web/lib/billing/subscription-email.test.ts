import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("./chargebee", () => ({
  chargebeeRequest: vi.fn(),
  chargebeeSite: () => "millchat-test",
}));
import {
  sendSubscriptionEmail,
  shouldSendPaymentFailure,
  subscriptionEmailContent,
} from "./subscription-email";
const base = {
  workspaceName: "Acme <script>",
  slug: "acme",
  subscription: {
    id: "mill_a",
    customer_id: "mill_a",
    resource_version: 1,
    status: "active",
    current_term_end: 1793923200,
    subscription_items: [{ item_price_id: "mill-essential-usd-monthly" }],
  },
};
describe("Mill billing emails", () => {
  it("welcomes a paid customer with the exact plan and portal link", () => {
    const result = subscriptionEmailContent({
      ...base,
      eventType: "subscription_created",
      invoice: { currency_code: "USD", status: "paid", amount_paid: 4900 },
    });
    expect(result.subject).toContain("Welcome to Mill");
    expect(result.text).toContain("$49 / month");
    expect(result.text).toContain("Payment received: $49");
    expect(result.html).not.toContain("Acme <script>");
    expect(result.text).toContain("https://app.mill.chat/app/acme/billing");
  });
  it("separates credit from the actual prorated payment", () => {
    const result = subscriptionEmailContent({
      ...base,
      eventType: "subscription_changed",
      invoice: {
        currency_code: "USD",
        status: "paid",
        amount_paid: 1500,
        credits_applied: 2000,
      },
    });
    expect(result.text).toContain("Payment received: $15");
    expect(result.text).toContain("Credit applied: $20");
  });
  it("does not claim a future downgrade is already active or paid", () => {
    const result = subscriptionEmailContent({
      ...base,
      eventType: "subscription_changes_scheduled",
    });
    expect(result.subject).toContain("scheduled");
    expect(result.text).toContain("Change takes effect:");
    expect(result.text).toContain("No charge");
    expect(result.text).not.toContain("Payment received");
  });
});

describe("failed payments", () => {
  it("directs the customer to Mill without claiming payment or plan activation", () => {
    const result = subscriptionEmailContent({
      ...base,
      eventType: "payment_failed",
      invoice: {
        currency_code: "USD",
        status: "payment_due",
        amount_due: 4900,
      },
    });
    expect(result.subject).toContain("could not be completed");
    expect(result.text).toContain("Amount due: $49");
    expect(result.text).toContain("https://app.mill.chat/app/acme/billing");
    expect(result.text).not.toContain("now active");
    expect(result.text).not.toContain("Payment received");
  });
  it("suppresses delayed failure notifications once the invoice is paid or voided", () => {
    expect(shouldSendPaymentFailure({ status: "paid", amount_due: 0 })).toBe(
      false,
    );
    expect(
      shouldSendPaymentFailure({ status: "voided", amount_due: 4900 }),
    ).toBe(false);
    expect(
      shouldSendPaymentFailure({ status: "payment_due", amount_due: 0 }),
    ).toBe(false);
    expect(
      shouldSendPaymentFailure({ status: "payment_due", amount_due: 4900 }),
    ).toBe(true);
    expect(
      shouldSendPaymentFailure({ status: "not_paid", amount_due: 4900 }),
    ).toBe(true);
  });
});

import { chargebeeRequest } from "./chargebee";
import { createServiceClient } from "@/lib/supabase/service";

describe("payment failure delivery", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reads the current invoice before sending a delayed failure notification", async () => {
    vi.mocked(chargebeeRequest).mockResolvedValue({
      invoice: {
        id: "invoice_1",
        customer_id: "mill_a",
        status: "paid",
        amount_due: 0,
      },
    });
    await sendSubscriptionEmail({
      id: "failure_1",
      event_type: "payment_failed",
      content: {
        subscription: base.subscription,
        invoice: {
          id: "invoice_1",
          customer_id: "mill_a",
          status: "payment_due",
          amount_due: 4900,
        },
      },
    });
    expect(chargebeeRequest).toHaveBeenCalledWith("invoices/invoice_1");
    expect(createServiceClient).not.toHaveBeenCalled();
  });
  it("rejects an invoice belonging to a different billing customer", async () => {
    vi.mocked(chargebeeRequest).mockResolvedValue({
      invoice: {
        id: "invoice_1",
        customer_id: "mill_other",
        status: "payment_due",
        amount_due: 4900,
      },
    });
    await expect(
      sendSubscriptionEmail({
        id: "failure_1",
        event_type: "payment_failed",
        content: {
          subscription: base.subscription,
          invoice: { id: "invoice_1", customer_id: "mill_a" },
        },
      }),
    ).rejects.toThrow("Invoice customer mismatch");
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

describe("Mill recovery email content", () => {
  it("includes the fixed deadline and next attempt without provider branding", () => {
    const result = subscriptionEmailContent({
      ...base,
      eventType: "payment_failed",
      invoice: {
        id: "inv1",
        customer_id: "mill_a",
        subscription_id: "mill_a",
        date: 1791244800,
        due_date: 1791244800,
        recurring: true,
        currency_code: "USD",
        status: "payment_due",
        amount_due: 4900,
        next_retry_at: 1791331200,
        first_invoice: false,
      },
    });
    expect(result.text).toContain("7-day payment grace period");
    expect(result.text).toContain("Next automatic attempt");
    expect(result.text + result.html).not.toMatch(/chargebee/i);
    expect(result.html).not.toContain("chargebee.com");
  });
  it("acknowledges recovery without claiming a new subscription", () => {
    const result = subscriptionEmailContent({
      ...base,
      eventType: "payment_succeeded",
      invoice: { currency_code: "USD", status: "paid", amount_paid: 4900 },
    });
    expect(result.subject).toBe("Your Mill payment has been received");
    expect(result.text).toContain("Payment received: $49");
    expect(result.text).not.toContain("Your workspace is now");
  });
});
