import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/server";
const mocks = vi.hoisted(() => ({ access: vi.fn(), balance: vi.fn() }));
vi.mock("@/lib/billing/access", () => ({
  workspaceBillingAccessForRender: mocks.access,
}));
vi.mock("@/lib/ai/credits", () => ({ aiCreditBalance: mocks.balance }));
import { loadWorkspaceAIConfig } from "./config";
function client(ai: unknown) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () =>
      Promise.resolve({ data: { settings_json: { ai } }, error: null }),
  };
  return { from: () => query } as unknown as AppSupabaseClient;
}
beforeEach(() => {
  vi.resetAllMocks();
});
describe("AI config isolation from basic chat", () => {
  it("keeps AI disabled without consulting an unavailable billing dependency", async () => {
    mocks.access.mockRejectedValue(new Error("Billing unavailable"));
    const result = await loadWorkspaceAIConfig(
      client({ enabled: false, features: { suggestedReplies: true } }),
      "workspace",
    );
    expect(result.flags.enabled).toBe(false);
    expect(result.flags.suggestedReplies).toBe(false);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it("still checks access and conversation allowance when AI is enabled", async () => {
    mocks.access.mockResolvedValue({ enabled: true, disabledAddOns: [] });
    mocks.balance.mockResolvedValue({ limit: 100, remaining: 0 });
    const result = await loadWorkspaceAIConfig(
      client({ enabled: true, features: { suggestedReplies: true } }),
      "workspace",
    );
    expect(mocks.access).toHaveBeenCalledWith("workspace");
    expect(mocks.balance).toHaveBeenCalledWith("workspace");
    expect(result.flags.suggestedReplies).toBe(true);
  });
  it("does not enable AI for a workspace whose access is paused", async () => {
    mocks.access.mockResolvedValue({ enabled: false, disabledAddOns: [] });
    const result = await loadWorkspaceAIConfig(
      client({ enabled: true, features: { suggestedReplies: true } }),
      "workspace",
    );
    expect(result.flags.suggestedReplies).toBe(false);
    expect(mocks.balance).not.toHaveBeenCalled();
  });
});
