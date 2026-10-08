import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  rpc: vi.fn(),
  get: vi.fn(),
  updateUser: vi.fn(),
  insert: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./guard", () => ({ requirePlatformAdministrator: mocks.guard }));
vi.mock("@/lib/env.server", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: {
      admin: { getUserById: mocks.get, updateUserById: mocks.updateUser },
    },
    from: () => ({
      insert: (value: unknown) => {
        mocks.insert(value);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: "audit" }, error: null }),
          }),
        };
      },
      update: () => ({ eq: mocks.finish }),
    }),
  }),
}));
import {
  changePlatformAccountEmail,
  deletePlatformAccount,
} from "./account-actions";
const input = {
  userId: "00000000-0000-4000-8000-000000000002",
  expectedEmail: "old@test.invalid",
  reason: "Remove duplicate old account",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    user: { id: "00000000-0000-4000-8000-000000000001" },
    role: "owner",
  });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.get.mockResolvedValue({
    data: { user: { email: input.expectedEmail } },
    error: null,
  });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.finish.mockResolvedValue({ error: null });
});
it("denies nonowners before accessing account data", async () => {
  mocks.guard.mockResolvedValue({ user: { id: "support" }, role: "support" });
  expect(
    (await changePlatformAccountEmail({ ...input, email: "new@test.invalid" }))
      .success,
  ).toBe(false);
  expect(
    (
      await deletePlatformAccount({
        ...input,
        confirmation: `DELETE ${input.expectedEmail}`,
      })
    ).success,
  ).toBe(false);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires an exact typed deletion confirmation", async () => {
  expect(
    (await deletePlatformAccount({ ...input, confirmation: "DELETE" })).success,
  ).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("passes verified actor and expected identity to the atomic delete", async () => {
  expect(
    (
      await deletePlatformAccount({
        ...input,
        confirmation: `DELETE ${input.expectedEmail}`,
      })
    ).success,
  ).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("platform_admin_delete_account", {
    p_actor_id: "00000000-0000-4000-8000-000000000001",
    p_user_id: input.userId,
    p_expected_email: input.expectedEmail,
    p_reason: input.reason,
  });
});
it("does not change an account whose email changed since it was displayed", async () => {
  mocks.get.mockResolvedValue({
    data: { user: { email: "changed@test.invalid" } },
    error: null,
  });
  expect(
    (await changePlatformAccountEmail({ ...input, email: "new@test.invalid" }))
      .success,
  ).toBe(false);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.updateUser).not.toHaveBeenCalled();
});
it("normalizes the new email and records an audit before confirmation", async () => {
  expect(
    (await changePlatformAccountEmail({ ...input, email: "NEW@test.invalid" }))
      .success,
  ).toBe(true);
  expect(mocks.updateUser).toHaveBeenCalledWith(input.userId, {
    email: "new@test.invalid",
    email_confirm: true,
  });
  expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.updateUser.mock.invocationCallOrder[0] ?? 0,
  );
});
it("reports an occupied address without claiming it was changed", async () => {
  mocks.updateUser.mockResolvedValue({ error: { code: "email_exists" } });
  expect(
    await changePlatformAccountEmail({ ...input, email: "taken@test.invalid" }),
  ).toEqual({
    success: false,
    message: "This email address is already in use. Choose another address.",
  });
});
