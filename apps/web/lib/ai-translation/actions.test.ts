import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), translate: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("./mobile", () => ({ mobileTranslate: mocks.translate }));
vi.mock("@/lib/mobile/access", () => ({ MobileError: class extends Error {}, authorizeMobile: mocks.authorize }));
import { loadOperatorReplyOriginals, translateInPortal } from "./actions";
const request = { workspaceId: "00000000-0000-4000-8000-000000000001", operation: "translateMessage", input: { consent: true } };
beforeEach(() => { vi.resetAllMocks(); });
it("rejects unsigned requests without translating", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await translateInPortal(request)).ok).toBe(false);
  expect(mocks.translate).not.toHaveBeenCalled();
});
it("rejects caller-supplied identity", async () => {
  expect((await translateInPortal({ ...request, userId: "someone" })).ok).toBe(false);
  expect(mocks.getUser).not.toHaveBeenCalled();
});
it("uses the verified cookie identity and shared authorized translation service", async () => {
  const user = { id: "verified-user", email_confirmed_at: "2026-10-08" };
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.translate.mockResolvedValue({ translatedText: "Bonjour", remaining: 999 });
  expect(await translateInPortal(request)).toEqual({ ok: true, result: { translatedText: "Bonjour", remaining: 999 } });
  expect(mocks.translate).toHaveBeenCalledWith(expect.objectContaining({ user }), request.workspaceId, request.operation, { ...request.input, withSourceLanguage: true });
});

it("does not reveal operator originals without a valid session", async () => {
 mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
 expect((await loadOperatorReplyOriginals({ workspaceId: request.workspaceId, conversationId: "00000000-0000-4000-8000-000000000002" })).ok).toBe(false);
 expect(mocks.authorize).not.toHaveBeenCalled();
});
it("requires company permission before accessing original reply cache", async () => {
 mocks.getUser.mockResolvedValue({ data: { user: { id: "user", email_confirmed_at: "2026-10-08" } }, error: null });
 mocks.authorize.mockRejectedValue(new Error("Foreign company"));
 expect((await loadOperatorReplyOriginals({ workspaceId: request.workspaceId, conversationId: "00000000-0000-4000-8000-000000000002" })).ok).toBe(false);
 expect(mocks.authorize).toHaveBeenCalledOnce();
});
