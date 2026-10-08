import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: {
    id: "tenant-id",
    email: "tenant@test.local",
    email_confirmed_at: "2026-01-01",
  },
  permission: null as null | { role: string },
  permissionError: null as null | Error,
  filter: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("LOGIN_REQUIRED");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mocks.user }, error: null }),
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (key: string, value: string) => {
          mocks.filter(key, value);
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: mocks.permission,
                  error: mocks.permissionError,
                }),
            }),
          };
        },
      }),
    }),
  }),
}));
import { requirePlatformAdministrator } from "./guard";
describe("platform permission boundary", () => {
  beforeEach(() => {
    mocks.permission = null;
    mocks.permissionError = null;
  });
  it("does not treat tenant ownership as platform access", async () => {
    await expect(requirePlatformAdministrator()).rejects.toThrow("NOT_FOUND");
  });
  it("resolves privileges only against the verified user ID", async () => {
    mocks.permission = { role: "owner" };
    expect((await requirePlatformAdministrator()).role).toBe("owner");
    expect(mocks.filter).toHaveBeenCalledWith("user_id", "tenant-id");
  });
  it("fails closed on a permissions database error", async () => {
    mocks.permission = { role: "owner" };
    mocks.permissionError = new Error("Database unavailable");
    await expect(requirePlatformAdministrator()).rejects.toThrow("NOT_FOUND");
  });
});
