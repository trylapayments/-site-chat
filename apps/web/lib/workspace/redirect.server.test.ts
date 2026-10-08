import { beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted((): { last: string | null } => ({ last: "b" }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve({}) }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: () => Promise.resolve({ user: { id: "operator" } }),
}));
vi.mock("@/lib/auth/recovery-cookie.server", () => ({
  hasValidRecoveryCookie: () => Promise.resolve(false),
}));
vi.mock("@/lib/auth/invite-cookie.server", () => ({
  readInviteCookieValidation: () => Promise.resolve({ valid: false, reason: "missing" }),
}));
vi.mock("@/lib/workspace/queries", () => ({
  fetchAccessibleWorkspaces: () => Promise.resolve({
    total_membership_count: 2,
    accessible_workspaces: [
      { workspace_id: "a", slug: "alpha", name: "Alpha", role: "owner" },
      { workspace_id: "b", slug: "beta", name: "Beta", role: "agent" },
    ],
  }),
  fetchLastWorkspaceId: () => Promise.resolve(fixtures.last),
}));
vi.mock("@/lib/workspace/invitation.server", () => ({
  acceptInvitationForUser: vi.fn(),
}));
import { resolveAuthenticatedDestination } from "./redirect.server";
beforeEach(() => {
  fixtures.last = "b";
});
it("restores the chosen company instead of overriding it with All Websites", async () => {
  expect(await resolveAuthenticatedDestination()).toBe("/app/beta");
});
it("never restores a removed or inaccessible company", async () => {
  fixtures.last = "removed";
  expect(await resolveAuthenticatedDestination()).toBe("/app/select-workspace");
});
it("keeps an authorized deep link ahead of the saved company", async () => {
  expect(await resolveAuthenticatedDestination("/app/alpha/visitors")).toBe(
    "/app/alpha/visitors",
  );
});
