import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({guard: vi.fn(), user: vi.fn(), core: vi.fn(), tools: vi.fn()}));
vi.mock("@/lib/inbox/guards", () => ({requireInboxWorkspace: mocks.guard}));
vi.mock("@/lib/auth/session", () => ({requireUser: mocks.user}));
vi.mock("@/lib/supabase/server", () => ({createClient: vi.fn(() => ({}))}));
vi.mock("@/lib/portal/conversation.server", () => ({
 UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
 loadPortalConversation: mocks.core, loadPortalConversationTools: mocks.tools,
}));
import { GET } from "./route";
const id = "a82f866d-a658-4a26-a5cd-924b1ff4586d";
const context = {params: Promise.resolve({workspaceSlug: "demo", conversationId: id})};
const request = (query = "") => new Request(`https://app.mill.chat/api/portal/demo/conversations/${id}${query}`);
beforeEach(() => {
 for (const fn of Object.values(mocks)) fn.mockReset();
 mocks.guard.mockResolvedValue({workspace: {workspace_id: "allowed"}});
 mocks.user.mockResolvedValue({user: {id: "member"}});
 mocks.core.mockResolvedValue({messages: {items: [{body: "private"}]}});
 mocks.tools.mockResolvedValue({notes: []});
});
it("requires a verified session before reading conversation data", async () => {
 mocks.user.mockResolvedValue({user: null});
 expect((await GET(request(), context)).status).toBe(401);
 expect(mocks.core).not.toHaveBeenCalled();
 expect(mocks.guard).not.toHaveBeenCalled();
});
it("denies a foreign workspace before any conversation or tools query", async () => {
 mocks.guard.mockRejectedValue(new Error("denied"));
 expect((await GET(request(), context)).status).toBe(403);
 expect(mocks.core).not.toHaveBeenCalled();
 expect(mocks.tools).not.toHaveBeenCalled();
});
it("rejects malformed focused message identifiers", async () => {
 expect((await GET(request("?message=other"), context)).status).toBe(400);
 expect(mocks.core).not.toHaveBeenCalled();
});
it("returns only core data with no shared or browser HTTP cache", async () => {
 const response = await GET(request(`?message=${id}`), context);
 expect(response.status).toBe(200);
 expect(response.headers.get("Cache-Control")).toBe("private, no-store");
 expect(mocks.core).toHaveBeenCalledWith({}, {workspace_id: "allowed"}, {id: "member"}, id, id);
 expect(mocks.tools).not.toHaveBeenCalled();
});
it("loads optional tools independently and preserves focused notes", async () => {
 const response = await GET(request(`?part=tools&note=${id}`), context);
 expect(await response.json()).toEqual({notes: []});
 expect(mocks.tools).toHaveBeenCalledWith({}, {workspace_id: "allowed"}, id, id);
 expect(mocks.core).not.toHaveBeenCalled();
});
it("denies a conversation rejected by the database permission guard", async () => {
 mocks.core.mockRejectedValue({code: "42501"});
 expect((await GET(request(), context)).status).toBe(403);
});
it("keeps temporary failures distinct from a missing conversation", async () => {
 mocks.core.mockRejectedValueOnce({code: "P0002"}).mockRejectedValueOnce(new Error("offline"));
 expect((await GET(request(), context)).status).toBe(404);
 expect((await GET(request(), context)).status).toBe(503);
});
