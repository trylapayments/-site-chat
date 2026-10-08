import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { from, query } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn() };
  return { query, from: vi.fn(() => query) };
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));
import {
  aggregateOperatorStatus,
  workspaceOperatorStatus,
} from "./availability";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("prioritizes an available teammate, then away, otherwise offline", () => {
  expect(aggregateOperatorStatus([])).toBe("offline");
  expect(aggregateOperatorStatus(["offline", "away"])).toBe("away");
  expect(aggregateOperatorStatus(["away", "available"])).toBe("available");
});
it("only reads active operators of this workspace and derives Away from activity", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T21:00:00Z"));
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockResolvedValue({
    data: [
      {
        status: "available",
        last_activity_at: "2026-10-04T20:55:00Z",
        idle_timeout_minutes: 5,
      },
    ],
    error: null,
  });
  expect(await workspaceOperatorStatus("workspace-a")).toBe("away");
  expect(query.eq).toHaveBeenCalledWith(
    "workspace_members.workspace_id",
    "workspace-a",
  );
  expect(query.eq).toHaveBeenCalledWith("workspace_members.status", "active");
  expect(query.in).toHaveBeenCalledWith("workspace_members.role", [
    "owner",
    "admin",
    "agent",
  ]);
});
