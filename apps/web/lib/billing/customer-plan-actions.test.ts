import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  auth: vi.fn(),
  estimate: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/inbox/guards", () => ({ requireInboxWorkspace: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mocks.auth } }),
}));
vi.mock("@/lib/billing/admin-plan-change", () => ({
  estimateAdminPlanChange: mocks.estimate,
  executeAdminPlanChange: mocks.execute,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}));
import {
  customerPlanEstimate,
  customerPlanConfirm,
} from "./customer-plan-actions";
const input = {
  slug: "test-workspace",
  planId: "growth",
  interval: "month",
  timing: "renewal",
};
const estimate = {
  version: 123,
  dueNow: 0,
  invoiceTotal: 0,
  credit: 0,
  nextTotal: 8900,
  effectiveAt: 2000000000,
};
describe("Customer billing authorization and confirmation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CHARGEBEE_API_KEY", "test-signing-only");
    mocks.guard.mockResolvedValue({
      workspace: { workspace_id: "workspace-a", role: "owner" },
    });
    mocks.auth.mockResolvedValue({ data: { user: { id: "owner-a" } } });
    mocks.estimate.mockResolvedValue(estimate);
    mocks.insert.mockReturnValue({ select: () => ({ single: mocks.single }) });
    mocks.single.mockResolvedValue({ data: { id: "audit-a" }, error: null });
  });
  it("does not call the billing provider for support users", async () => {
    mocks.guard.mockResolvedValue({
      workspace: { workspace_id: "workspace-a", role: "agent" },
    });
    expect((await customerPlanEstimate(input)).success).toBe(false);
    expect(mocks.estimate).not.toHaveBeenCalled();
  });
  it("rejects modified confirmation tokens", async () => {
    const q = await customerPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    expect((await customerPlanConfirm(input.slug, q.token + "x")).success).toBe(
      false,
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects another administrator's confirmation", async () => {
    const q = await customerPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    mocks.auth.mockResolvedValue({ data: { user: { id: "owner-b" } } });
    expect((await customerPlanConfirm(input.slug, q.token)).success).toBe(
      false,
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires a fresh review when the provider amount changes", async () => {
    const q = await customerPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    mocks.estimate.mockResolvedValue({ ...estimate, dueNow: 100 });
    expect((await customerPlanConfirm(input.slug, q.token)).success).toBe(
      false,
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not mutate billing if the audit record cannot be saved", async () => {
    const q = await customerPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    expect((await customerPlanConfirm(input.slug, q.token)).success).toBe(
      false,
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects confirmation for another workspace", async () => {
    const q = await customerPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    expect(
      (await customerPlanConfirm("another-workspace", q.token)).success,
    ).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("allows a billing administrator to confirm the reviewed change", async () => {
    mocks.guard.mockResolvedValue({
      workspace: { workspace_id: "workspace-a", role: "admin" },
    });
    const q = await customerPlanEstimate(input);
    if (!q.success) throw Error("missing quote");
    expect((await customerPlanConfirm(input.slug, q.token)).success).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith(
      "workspace-a",
      "growth",
      "month",
      "renewal",
      123,
    );
  });
});
