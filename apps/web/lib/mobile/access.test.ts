import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  workspaces: vi.fn(),
  billing: vi.fn(),
  member: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public",
  },
}));
vi.mock("@/lib/workspace/queries", () => ({
  fetchAccessibleWorkspaces: mocks.workspaces,
}));
vi.mock("@/lib/billing/access", () => ({
  workspaceBillingAccess: mocks.billing,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
import { authenticateMobile, authorizeMobile } from "./access";
const workspaceId = "12345678-1234-4123-8123-123456789abc";
const chain = { select: () => chain, eq: () => chain, single: mocks.member };
const context = {
  user: { id: "user" },
  client: { from: () => chain },
} as unknown as Awaited<ReturnType<typeof authenticateMobile>>;
describe("mobile authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaces.mockResolvedValue({
      accessible_workspaces: [{ workspace_id: workspaceId, role: "agent" }],
    });
    mocks.billing.mockResolvedValue({ enabled: true });
    mocks.member.mockResolvedValue({ data: { id: "member" }, error: null });
  });
  it("requires a verified bearer token", async () => {
    await expect(
      authenticateMobile(new Request("https://test")),
    ).rejects.toMatchObject({ status: 401 });
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Invalid"),
    });
    await expect(
      authenticateMobile(
        new Request("https://test", {
          headers: { authorization: "Bearer forged" },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects foreign workspace before billing or privileged queries", async () => {
    await expect(
      authorizeMobile(context, "foreign", "send_messages"),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.billing).not.toHaveBeenCalled();
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("rejects an auth response with no user even when no error is returned", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(
      authenticateMobile(
        new Request("https://test", {
          headers: { authorization: "Bearer expired" },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("viewer can read but cannot send", async () => {
    mocks.workspaces.mockResolvedValue({
      accessible_workspaces: [{ workspace_id: workspaceId, role: "viewer" }],
    });
    await expect(authorizeMobile(context, workspaceId)).resolves.toMatchObject({
      memberId: "member",
    });
    await expect(
      authorizeMobile(context, workspaceId, "send_messages"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("enforces existing subscription restrictions", async () => {
    mocks.billing.mockResolvedValue({ enabled: false });
    await expect(authorizeMobile(context, workspaceId)).rejects.toMatchObject({
      status: 403,
      code: "WORKSPACE_DISABLED",
    });
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("fails closed when membership was revoked", async () => {
    mocks.member.mockResolvedValue({ data: null, error: new Error("Revoked") });
    await expect(authorizeMobile(context, workspaceId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("fails closed when an active membership is absent without a query error", async () => {
    mocks.member.mockResolvedValue({ data: null, error: null });
    await expect(authorizeMobile(context, workspaceId)).rejects.toMatchObject({
      status: 403,
    });
  });
});
