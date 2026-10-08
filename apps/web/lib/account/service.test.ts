import { beforeEach, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/server";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  deleteRpc: vi.fn(),
  billing: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key",
  },
}));
vi.mock("@/lib/billing/chargebee", () => ({
  loadChargebeeBilling: mocks.billing,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
    rpc: mocks.deleteRpc,
  }),
}));
import { deleteOwnAccount } from "./service";
const email = "account@test.invalid";
const preview = {
  email,
  personalCompanies: [
    { id: "00000000-0000-4000-8000-000000000003", name: "Personal" },
  ],
  sharedCompanies: [],
  blockers: [],
};
const client = {
  auth: { getUser: mocks.getUser },
  rpc: mocks.rpc,
} as unknown as AppSupabaseClient;
const input = { confirmation: email, password: "existing-test-password" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "actor", email } },
    error: null,
  });
  mocks.signIn.mockResolvedValue({
    data: { user: { id: "actor" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: preview, error: null });
  mocks.deleteRpc.mockResolvedValue({ data: { deleted: true }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.billing.mockResolvedValue({});
});
it("rejects a caller-supplied userId before any authentication or deletion", async () => {
  await expect(
    deleteOwnAccount(client, { ...input, userId: "other" }),
  ).rejects.toThrow();
  expect(mocks.getUser).not.toHaveBeenCalled();
  expect(mocks.deleteRpc).not.toHaveBeenCalled();
});
it("requires exact current email before verifying password", async () => {
  await expect(
    deleteOwnAccount(client, { ...input, confirmation: "other@test.invalid" }),
  ).rejects.toThrow("exact account email");
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it("wrong password never reaches deletion", async () => {
  mocks.signIn.mockResolvedValue({
    data: { user: null },
    error: { message: "bad" },
  });
  await expect(deleteOwnAccount(client, input)).rejects.toThrow(
    "verify your password",
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.deleteRpc).not.toHaveBeenCalled();
});
it("requires reauthentication to return the same actor", async () => {
  mocks.signIn.mockResolvedValue({
    data: { user: { id: "other" } },
    error: null,
  });
  await expect(deleteOwnAccount(client, input)).rejects.toThrow(
    "verify your password",
  );
  expect(mocks.deleteRpc).not.toHaveBeenCalled();
});
it("refreshes only server-derived personal companies then deletes using the fresh session", async () => {
  expect(await deleteOwnAccount(client, input)).toEqual({ deleted: true });
  expect(mocks.billing).toHaveBeenCalledWith(
    "00000000-0000-4000-8000-000000000003",
  );
  expect(mocks.deleteRpc).toHaveBeenCalledWith("delete_own_account", {
    p_confirmation: email,
  });
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("returns a transaction-time blocker and revokes only the verification session", async () => {
  mocks.deleteRpc.mockResolvedValue({
    data: {
      deleted: false,
      preview: {
        ...preview,
        blockers: [
          { code: "TRANSFER_OWNERSHIP", message: "Assign another owner" },
        ],
      },
    },
    error: null,
  });
  expect((await deleteOwnAccount(client, input)).deleted).toBe(false);
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("billing refresh failure does not delete and closes the temporary auth session", async () => {
  mocks.billing.mockRejectedValue(new Error("provider failed"));
  await expect(deleteOwnAccount(client, input)).rejects.toThrow();
  expect(mocks.deleteRpc).not.toHaveBeenCalled();
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("does not expose database details", async () => {
  mocks.deleteRpc.mockResolvedValue({
    data: null,
    error: { message: "private database detail" },
  });
  await expect(deleteOwnAccount(client, input)).rejects.toThrow(
    "Unable to confirm account deletion",
  );
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});
