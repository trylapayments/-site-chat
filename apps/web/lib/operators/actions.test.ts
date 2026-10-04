import { beforeEach, expect, it, vi } from "vitest";
const { auth, context, member, from, write, read } = vi.hoisted(() => ({
  auth: vi.fn(),
  context: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: auth },
    from: () => {
      const query = { select: () => query, eq: () => query, single: member };
      return query;
    },
  }),
}));
vi.mock("@/lib/workspace/redirect.server", () => ({
  getWorkspaceContext: context,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));
import { syncOperatorAvailability } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ data: { user: { id: "user-a" } } });
  context.mockResolvedValue({
    membership: {
      accessible_workspaces: [
        {
          slug: "workspace-a",
          workspace_id: "workspace-a-id",
          role: "agent",
          name: "Workspace A",
        },
      ],
    },
  });
  member.mockResolvedValue({ data: { id: "member-a" }, error: null });
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: read,
    upsert: write,
  };
  from.mockReturnValue(query);
  write.mockResolvedValue({ error: null });
  read.mockResolvedValue({ data: { status: "away" }, error: null });
});
it("does not write for a signed-out user or a different workspace", async () => {
  await expect(
    syncOperatorAvailability("workspace-b", "available"),
  ).rejects.toThrow("Workspace access denied");
  auth.mockResolvedValue({ data: { user: null } });
  await expect(
    syncOperatorAvailability("workspace-a", "available"),
  ).rejects.toThrow("sign in");
  expect(from).not.toHaveBeenCalled();
});
it("rejects inactive membership and viewers before writing", async () => {
  member.mockResolvedValue({ data: null, error: new Error("inactive") });
  await expect(
    syncOperatorAvailability("workspace-a", "available"),
  ).rejects.toThrow("Workspace access denied");
  context.mockResolvedValue({
    membership: {
      accessible_workspaces: [
        {
          slug: "workspace-a",
          workspace_id: "workspace-a-id",
          role: "viewer",
          name: "Workspace A",
        },
      ],
    },
  });
  await expect(
    syncOperatorAvailability("workspace-a", "available"),
  ).rejects.toThrow("permission");
  expect(from).not.toHaveBeenCalled();
});
it("writes only the authenticated member and keeps heartbeats from overwriting another tab's choice", async () => {
  expect(await syncOperatorAvailability("workspace-a", "available")).toBe(
    "available",
  );
  expect(write).toHaveBeenCalledWith(
    expect.objectContaining({ member_id: "member-a", status: "available" }),
  );
  write.mockClear();
  expect(await syncOperatorAvailability("workspace-a")).toBe("away");
  expect(write).not.toHaveBeenCalled();
});
