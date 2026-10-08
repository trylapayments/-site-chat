import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(), context: vi.fn(), service: vi.fn(), update: vi.fn(), eq: vi.fn(), statuses: vi.fn(),
}));
vi.mock("@/lib/widget/context", () => ({ verifyEmbedContext: mocks.verify, corsOriginFromEmbed: () => "https://example.com" }));
vi.mock("@/lib/widget/constants", () => ({ getEmbedTokenFromRequest: () => "embed" }));
vi.mock("@/lib/widget/origin", () => ({ requestOriginMatchesEmbed: () => true, getRequestOrigin: () => "https://example.com", getClientIp: () => "test" }));
vi.mock("@/lib/widget/responses", () => ({ getBearerToken: () => "visitor-session", widgetOptionsResponse: () => null }));
vi.mock("@/lib/widget/service", () => ({ consumeWidgetRateLimit: () => Promise.resolve(true) }));
vi.mock("@/lib/conversation-wrapup/context", () => ({ visitorConversationContext: mocks.context, endVisitorConversation: mocks.update }));
vi.mock("@/lib/conversation-wrapup/transcript", () => ({ sendConversationTranscript: vi.fn() }));
vi.mock("@/lib/chat-setup/queries", () => ({ fetchChatSetup: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.service }));
import { POST } from "@/app/api/v1/widget/conversation/route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function request() { return new Request("https://app.mill.chat/api/v1/widget/conversation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end", conversationId: id }) }); }
beforeEach(() => {
 vi.clearAllMocks(); mocks.verify.mockResolvedValue({ workspaceId: "workspace", parentOrigin: "https://example.com" });
 mocks.context.mockResolvedValue({ conversationId: id });
 const query = { eq: mocks.eq, in: mocks.statuses }; mocks.eq.mockReturnValue(query); mocks.statuses.mockResolvedValue({ error: null }); mocks.update.mockReturnValue(query);
 mocks.service.mockReturnValue({ from: () => ({ update: mocks.update }) });
});
it("ends only the authenticated visitor’s current workspace conversation", async () => {
 expect((await POST(request())).status).toBe(200);
 expect(mocks.update).toHaveBeenCalledWith("workspace","visitor-session",id);
});
it("rejects an attempt to end another conversation without writing", async () => {
 mocks.context.mockResolvedValue({ conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
 expect((await POST(request())).status).toBe(409); expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects invalid embed context without writing", async () => {
 mocks.verify.mockResolvedValue(null); expect((await POST(request())).status).toBe(401); expect(mocks.update).not.toHaveBeenCalled();
});
