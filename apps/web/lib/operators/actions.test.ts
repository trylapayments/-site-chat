import { beforeEach, expect, it, vi } from "vitest";
const { auth, context, member, from, write, read, update } = vi.hoisted(() => ({
  auth: vi.fn(),
  context: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
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
    update,
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    single: read,
    upsert: write,
  };
  from.mockReturnValue(query);
  update.mockReturnValue(query);
  write.mockResolvedValue({ error: null });
  read.mockResolvedValue({
    data: {
      status: "away",
      last_activity_at: new Date().toISOString(),
      idle_timeout_minutes: 5,
    },
    error: null,
  });
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
it("writes only the authenticated member and keeps refreshes from overwriting another tab's choice", async () => {
  read.mockResolvedValue({
    data: {
      status: "available",
      last_activity_at: new Date().toISOString(),
      idle_timeout_minutes: 5,
    },
    error: null,
  });
  expect(await syncOperatorAvailability("workspace-a", "available")).toBe(
    "available",
  );
  expect(write).toHaveBeenCalledWith(
    { member_id: "member-a" },
    { onConflict: "member_id", ignoreDuplicates: true },
  );
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "available",
    }),
  );
  expect(update.mock.calls[0]?.[0]).toHaveProperty("last_activity_at");
  update.mockClear();
  read.mockResolvedValue({
    data: {
      status: "away",
      last_activity_at: new Date().toISOString(),
      idle_timeout_minutes: 5,
    },
    error: null,
  });
  expect(await syncOperatorAvailability("workspace-a")).toBe("away");
  expect(update.mock.calls[0]?.[0]).toHaveProperty("last_seen_at");
  expect(update.mock.calls[0]?.[0]).not.toHaveProperty("status");
  expect(update.mock.calls[0]?.[0]).not.toHaveProperty("last_activity_at");
});
