import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), balance: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/ai-translation/mobile", () => ({
  mobileTranslationCapabilities: mocks.balance,
}));
import { AccountTranslationUsage } from "@/components/settings/AccountTranslationUsage";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "operator", email_confirmed_at: "2026-01-01" } },
    error: null,
  });
  mocks.balance.mockResolvedValue({
    enabled: true,
    monthlyLimit: 1000,
    remaining: 175,
  });
});
it("shows the authoritative shared account balance rather than a company estimate", async () => {
  const html = renderToStaticMarkup(
    await AccountTranslationUsage({ workspaceId: "company-b" }),
  );
  expect(mocks.balance).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { id: "operator", email_confirmed_at: "2026-01-01" },
    }),
    "company-b",
  );
  expect(html).toContain("175");
  expect(html).toContain("825 of 1,000 used");
  expect(html).toContain('aria-valuenow="825"');
  expect(html).toContain("running low");
  expect(html).toContain("share this allowance");
});
it("distinguishes exhausted allowance from unavailable balance", async () => {
  mocks.balance.mockResolvedValue({
    enabled: true,
    monthlyLimit: 1000,
    remaining: 0,
  });
  expect(
    renderToStaticMarkup(await AccountTranslationUsage({ workspaceId: "a" })),
  ).toContain("used up");
  mocks.balance.mockRejectedValue(new Error("Database unavailable"));
  const html = renderToStaticMarkup(
    await AccountTranslationUsage({ workspaceId: "a" }),
  );
  expect(html).toContain("could not be loaded");
  expect(html).not.toContain("used up");
});
it("does not read usage for an unverified session", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "operator", email_confirmed_at: null } },
    error: null,
  });
  await AccountTranslationUsage({ workspaceId: "a" });
  expect(mocks.balance).not.toHaveBeenCalled();
});
