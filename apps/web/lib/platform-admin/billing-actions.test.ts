import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  estimate: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./guard", () => ({ requirePlatformAdministrator: mocks.guard }));
vi.mock("@/lib/billing/admin-plan-change", () => ({
  estimateAdminPlanChange: mocks.estimate,
  executeAdminPlanChange: mocks.execute,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}));
import { adminPlanEstimate, adminPlanConfirm } from "./billing-actions";
const input = {
  workspaceId: "69a1d371-0b57-4d7f-be9a-9b8f6eb50f27",
  planId: "growth",
  interval: "month",
  timing: "renewal",
  reason: "Customer request",
};
const estimate = {
  version: 123,
  dueNow: 0,
  invoiceTotal: 0,
  credit: 0,
  nextTotal: 8900,
  effectiveAt: 2000000000,
};
describe("Platform billing authorization and confirmation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CHARGEBEE_API_KEY", "test-signing-only");
    mocks.guard.mockResolvedValue({ user: { id: "owner-a" }, role: "owner" });
    mocks.estimate.mockResolvedValue(estimate);
    mocks.insert.mockReturnValue({ select: () => ({ single: mocks.single }) });
    mocks.single.mockResolvedValue({ data: { id: "audit-a" }, error: null });
  });
  it("does not call the billing provider for support users", async () => {
    mocks.guard.mockResolvedValue({
      user: { id: "support-a" },
      role: "support",
    });
    expect((await adminPlanEstimate(input)).success).toBe(false);
    expect(mocks.estimate).not.toHaveBeenCalled();
  });
  it("rejects modified confirmation tokens", async () => {
    const q = await adminPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    expect((await adminPlanConfirm(q.token + "x")).success).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects another administrator's confirmation", async () => {
    const q = await adminPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    mocks.guard.mockResolvedValue({ user: { id: "owner-b" }, role: "owner" });
    expect((await adminPlanConfirm(q.token)).success).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires a fresh review when the provider amount changes", async () => {
    const q = await adminPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    mocks.estimate.mockResolvedValue({ ...estimate, dueNow: 100 });
    expect((await adminPlanConfirm(q.token)).success).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not mutate billing if the audit record cannot be saved", async () => {
    const q = await adminPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    expect((await adminPlanConfirm(q.token)).success).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
