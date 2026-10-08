import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  request: vi.fn(),
  load: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./guard", () => ({ requirePlatformAdministrator: mocks.guard }));
vi.mock("@/lib/billing/chargebee", () => ({
  chargebeeRequest: mocks.request,
  loadChargebeeBilling: mocks.load,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}));
import { adminDebtEstimate, adminDebtConfirm } from "./debt-actions";
const input = {
  workspaceId: "69a1d371-0b57-4d7f-be9a-9b8f6eb50f27",
  reason: "Customer goodwill",
};
const invoice = {
  id: "5",
  customer_id: `mill_${input.workspaceId}`,
  status: "payment_due",
  amount_due: 100,
  currency_code: "USD",
  resource_version: 123,
  date: 1000,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CHARGEBEE_API_KEY", "test-signing-only");
  mocks.guard.mockResolvedValue({ user: { id: "owner-a" }, role: "owner" });
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("/write_off")
        ? {
            invoice: {
              ...invoice,
              status: "paid",
              amount_due: 0,
              write_off_amount: 100,
            },
          }
        : { list: [{ invoice }] },
    ),
  );
  mocks.insert.mockReturnValue({ select: () => ({ single: mocks.single }) });
  mocks.single.mockResolvedValue({ data: { id: "audit-a" }, error: null });
});
it("rejects support users before reading billing", async () => {
  mocks.guard.mockResolvedValue({ user: { id: "support" }, role: "support" });
  expect((await adminDebtEstimate(input)).success).toBe(false);
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects tampering and another admin's review", async () => {
  const q = await adminDebtEstimate(input);
  if (!q.success) throw Error("missing quote");
  expect((await adminDebtConfirm(q.token + "x")).success).toBe(false);
  mocks.guard.mockResolvedValue({ user: { id: "owner-b" }, role: "owner" });
  expect((await adminDebtConfirm(q.token)).success).toBe(false);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("requires fresh confirmation for changed amounts", async () => {
  const q = await adminDebtEstimate(input);
  if (!q.success) throw Error("missing quote");
  mocks.request.mockResolvedValue({
    list: [{ invoice: { ...invoice, amount_due: 101 } }],
  });
  expect((await adminDebtConfirm(q.token)).success).toBe(false);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("does not write off debt without an audit record", async () => {
  const q = await adminDebtEstimate(input);
  if (!q.success) throw Error("missing quote");
  mocks.single.mockResolvedValue({
    data: null,
    error: { message: "unavailable" },
  });
  expect((await adminDebtConfirm(q.token)).success).toBe(false);
  expect(
    mocks.request.mock.calls.some(([path]) =>
      String(path).includes("write_off"),
    ),
  ).toBe(false);
});
it("rejects another customer's invoice and an in-progress payment", async () => {
  for (const changed of [
    { customer_id: "mill_other" },
    { linked_payments: [{ txn_status: "in_progress" }] },
  ]) {
    mocks.request.mockResolvedValue({
      list: [{ invoice: { ...invoice, ...changed } }],
    });
    expect((await adminDebtEstimate(input)).success).toBe(false);
  }
});
it("writes off the confirmed debt without changing the subscription", async () => {
  const q = await adminDebtEstimate(input);
  if (!q.success) throw Error("missing quote");
  expect((await adminDebtConfirm(q.token)).success).toBe(true);
  const call = mocks.request.mock.calls.find(([path]) =>
    String(path).endsWith("/write_off"),
  );
  expect(call?.[0]).toBe("invoices/5/write_off");
  expect((call?.[1] as URLSearchParams).get("comment")).toBe(input.reason);
  expect(call?.[2]).toBe("mill-writeoff-5-123");
  expect(
    mocks.request.mock.calls.some(([path]) =>
      String(path).startsWith("subscriptions/"),
    ),
  ).toBe(false);
  expect(mocks.load).toHaveBeenCalledWith(input.workspaceId);
});
