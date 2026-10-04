import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { from, query } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), gte: vi.fn() };
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
it("only reads active members of this workspace with a live heartbeat", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T21:00:00Z"));
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.gte.mockResolvedValue({ data: [{ status: "away" }], error: null });
  expect(await workspaceOperatorStatus("workspace-a")).toBe("away");
  expect(query.eq).toHaveBeenCalledWith(
    "workspace_members.workspace_id",
    "workspace-a",
  );
  expect(query.eq).toHaveBeenCalledWith("workspace_members.status", "active");
  expect(query.gte).toHaveBeenCalledWith(
    "last_seen_at",
    "2026-10-04T20:58:30.000Z",
  );
});
