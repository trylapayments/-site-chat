import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ billing: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/billing/access", () => ({ workspaceBillingAccess: mocks.billing }));
vi.mock("@/lib/env.server", () => ({ env: {} }));
vi.mock("@/lib/billing/chargebee", () => ({ chargebeeSite: () => null }));
import { mobileTranslationCapabilities, mobileTranslate } from "./mobile";
const workspace = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const owner = "00000000-0000-4000-8000-000000000003";
function context() {
 const query = { select: vi.fn(), eq: vi.fn(), or: vi.fn(), overrideTypes: mocks.rows };
 query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.or.mockReturnValue(query);
 return { client: { from: () => query }, user: { id: actor } } as unknown as Parameters<typeof mobileTranslationCapabilities>[0];
}
beforeEach(() => {
 vi.resetAllMocks(); vi.stubEnv("MILL_AI_TRANSLATION_ENABLED", "0");
 mocks.billing.mockResolvedValue({ enabled: true });
 mocks.rows.mockResolvedValue({ data: [{ id: actor, user_id: actor, role: "agent" }, { id: owner, user_id: owner, role: "owner" }], error: null });
});
it("rejects callers without current active company membership", async () => {
 mocks.rows.mockResolvedValue({ data: [{ id: owner, user_id: owner, role: "owner" }], error: null });
 await expect(mobileTranslationCapabilities(context(), workspace)).rejects.toThrow("Workspace access denied");
});
it("checks billing restrictions even with a valid agent role", async () => {
 mocks.billing.mockResolvedValue({ enabled: false });
 await expect(mobileTranslationCapabilities(context(), workspace)).rejects.toThrow("Workspace access is restricted");
});
it("does not let a viewer translate an outgoing reply", async () => {
 mocks.rows.mockResolvedValue({ data: [{ id: actor, user_id: actor, role: "viewer" }, { id: owner, user_id: owner, role: "owner" }], error: null });
 await expect(mobileTranslate(context(), workspace, "previewReplyTranslation", { conversationId: workspace, requestId: actor, text: "Hello", targetLanguage: "en", consent: true })).rejects.toThrow("Workspace access denied");
});
it("does not reuse membership after revocation on the next request", async () => {
 await expect(mobileTranslationCapabilities(context(), workspace)).resolves.toEqual({ enabled: false, remaining: 0, monthlyLimit: 0 });
 mocks.rows.mockResolvedValue({ data: [], error: null });
 await expect(mobileTranslationCapabilities(context(), workspace)).rejects.toThrow("Workspace access denied");
 expect(mocks.billing).toHaveBeenCalledTimes(2);
});
