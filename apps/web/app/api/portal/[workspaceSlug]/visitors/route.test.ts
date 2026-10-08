import { beforeEach, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
const guard = vi.hoisted(() => vi.fn());
const user = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inbox/guards", () => ({ requireInboxWorkspace: guard }));
vi.mock("@/lib/auth/session", () => ({ requireUser: user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/visitors/queries", () => ({ fetchAllActiveVisitors: list }));
import { GET } from "./route";
const request = new Request("https://app.mill.chat/api/portal/demo/visitors");
const context = { params: Promise.resolve({ workspaceSlug: "demo" }) };
beforeEach(() => {
  list.mockReset();
  guard.mockReset().mockResolvedValue({ workspace: { workspace_id: "test" } });
  user.mockReset().mockResolvedValue({ user: { id: "member" } });
});
it("authorizes the workspace before returning private uncached visitor data", async () => {
  list.mockResolvedValue([]);
  const response = await GET(request, context);
  expect(list).toHaveBeenCalledWith({});
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.json()).toEqual([]);
});
it("does not expose visitor data when authorization fails", async () => {
  list.mockRejectedValue(new Error("denied"));
  expect((await GET(request, context)).status).toBe(503);
});

it("rejects expired sessions before reading private visitor data", async () => {
  user.mockResolvedValue({ user: null });
  expect((await GET(request, context)).status).toBe(401);
  expect(list).not.toHaveBeenCalled();
});
it("rejects another workspace before reading private visitor data", async () => {
  guard.mockRejectedValue(new Error("forbidden"));
  expect((await GET(request, context)).status).toBe(403);
  expect(list).not.toHaveBeenCalled();
});
