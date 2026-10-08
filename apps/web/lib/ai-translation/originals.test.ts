import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn() }));
vi.mock("./mobile", () => ({ translationServiceClient: mocks.service }));
import { loadAuthorizedTranslationOriginals } from "./originals";
function query(result: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), overrideTypes: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const fn of [chain.select, chain.eq, chain.in, chain.order, chain.limit]) fn.mockReturnValue(chain);
  chain.overrideTypes.mockResolvedValue(result);
  return chain;
}
const metadata = JSON.stringify({ original: "Hello", text: "Bonjour", sourceLanguage: "en" });
function setup(body = "Bonjour", payload = metadata) {
  const message = query({ data: [{ id: "message", client_message_id: "request", body }], error: null });
  const requests = query({ data: [{ request_id: "request", job_id: "job" }], error: null });
  const jobs = query({ data: [{ id: "job", translated_text: payload, target_language: "fr" }], error: null });
  const from = vi.fn().mockReturnValueOnce(requests).mockReturnValueOnce(jobs);
  mocks.service.mockReturnValue({ from });
  const client = { from: vi.fn().mockReturnValue(message) } as unknown as Parameters<typeof loadAuthorizedTranslationOriginals>[0];
  return { client, message, requests, jobs };
}
beforeEach(() => vi.clearAllMocks());
it("returns only originals matching delivered operator messages and scopes private queries", async () => {
  const { client, message, requests, jobs } = setup();
  await expect(loadAuthorizedTranslationOriginals(client, "workspace", "conversation")).resolves.toEqual({ originals: { message: { original: "Hello", translated: "Bonjour", sourceLanguage: "en", targetLanguage: "fr" } } });
  expect(message.eq).toHaveBeenCalledWith("is_internal", false);
  expect(message.eq).toHaveBeenCalledWith("conversation_id", "conversation");
  expect(requests.eq).toHaveBeenCalledWith("workspace_id", "workspace");
  expect(jobs.eq).toHaveBeenCalledWith("conversation_id", "conversation");
});
it("does not reveal cached drafts which differ from the sent message", async () => {
  const { client } = setup("Something else");
  await expect(loadAuthorizedTranslationOriginals(client, "workspace", "conversation")).resolves.toEqual({ originals: {} });
});
it("accepts the explicitly shared original plus translation", async () => {
  const { client } = setup("Hello\n\nBonjour");
  expect((await loadAuthorizedTranslationOriginals(client, "workspace", "conversation")).originals.message?.original).toBe("Hello");
});
it("ignores legacy text caches without operator original metadata", async () => {
  const { client } = setup("Bonjour", "Bonjour");
  await expect(loadAuthorizedTranslationOriginals(client, "workspace", "conversation")).resolves.toEqual({ originals: {} });
});
it("never reads privileged translation data when the RLS message query fails", async () => {
  const chain = query({ data: null, error: new Error("denied") });
  const client = { from: () => chain } as unknown as Parameters<typeof loadAuthorizedTranslationOriginals>[0];
  await expect(loadAuthorizedTranslationOriginals(client, "workspace", "conversation")).rejects.toThrow("Unable to read");
  expect(mocks.service).not.toHaveBeenCalled();
});
