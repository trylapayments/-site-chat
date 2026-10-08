import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  request: vi.fn(),
  load: vi.fn(),
  subscription: vi.fn(),
  email: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/inbox/guards", () => ({ requireInboxWorkspace: mocks.guard }));
vi.mock("./chargebee", () => ({
  chargebeeRequest: mocks.request,
  loadChargebeeBilling: mocks.load,
}));
vi.mock("./subscriptions", () => ({
  retrieveMillSubscription: mocks.subscription,
}));
vi.mock("./subscription-email", () => ({
  sendSubscriptionEmailForChange: mocks.email,
}));
import { retryInvoicePayment } from "./recovery-actions";
const input = { slug: "fixture", invoiceId: "5", amount: 100, version: 123 };
const invoice = {
  id: "5",
  customer_id: "mill_workspace-a",
  status: "payment_due",
  amount_due: 100,
  resource_version: 123,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({
    workspace: { workspace_id: "workspace-a", role: "owner" },
  });
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve(
      path === "invoices/5"
        ? { invoice }
        : path.startsWith("customers/")
          ? { customer: { primary_payment_source_id: "card-new" } }
          : { invoice: { ...invoice, status: "paid", amount_due: 0 } },
    ),
  );
  mocks.subscription.mockResolvedValue(null);
});
it("does not charge for agents", async () => {
  mocks.guard.mockResolvedValue({
    workspace: { workspace_id: "workspace-a", role: "agent" },
  });
  expect((await retryInvoicePayment(input)).success).toBe(false);
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects invoices belonging to another customer", async () => {
  mocks.request.mockResolvedValue({
    invoice: { ...invoice, customer_id: "mill_other" },
  });
  expect((await retryInvoicePayment(input)).success).toBe(false);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("requires another confirmation when the amount or version changes", async () => {
  for (const change of [{ amount_due: 101 }, { resource_version: 124 }]) {
    mocks.request.mockResolvedValue({ invoice: { ...invoice, ...change } });
    expect((await retryInvoicePayment(input)).success).toBe(false);
  }
  expect(
    mocks.request.mock.calls.every(([path]) => path === "invoices/5"),
  ).toBe(true);
});
it("collects using the current default card with an idempotent request", async () => {
  expect((await retryInvoicePayment(input)).success).toBe(true);
  const call = mocks.request.mock.calls.find(([path]) =>
    String(path).endsWith("/collect_payment"),
  );
  expect((call?.[1] as URLSearchParams).get("payment_source_id")).toBe(
    "card-new",
  );
  expect(call?.[2]).toBe("mill-recover-5-123");
  expect(mocks.load).toHaveBeenCalledWith("workspace-a");
});
it("does not collect an already paid invoice", async () => {
  mocks.request.mockResolvedValue({
    invoice: { ...invoice, status: "paid", amount_due: 0 },
  });
  expect((await retryInvoicePayment(input)).success).toBe(false);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
