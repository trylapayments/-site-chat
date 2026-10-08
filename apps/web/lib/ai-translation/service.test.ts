import { describe, expect, it, vi } from "vitest";
import { performTranslation, type TranslationDependencies, type TranslationInput } from "./service";
const input: TranslationInput = {
  workspaceId: "company-a",
  conversationId: "chat-a",
  targetLanguage: "fr",
  consent: true,
  mode: "draft",
  text: "Hello",
  requestId: "request-a",
};
function dependencies() {
  const deps: TranslationDependencies = {
    enabled: true,
    provider: {
      id: "openai",
      metadata: { provider: "openai", model: "gpt-4o-mini" },
      generate: vi.fn(async () => ({
        text: "Bonjour",
        finishReason: "stop",
        model: "gpt-4o-mini",
        usage: { promptTokens: 100, completionTokens: 2, totalTokens: 102 },
      })),
    } as unknown as TranslationDependencies["provider"],
    authorize: vi.fn(async () => ({ enabled: true, ownerUserId: "owner-a", monthlyLimit: 1000 })),
    resolveSource: vi.fn(async () => (input.mode === "draft" ? input.text : "")),
    reserve: vi.fn(async () => ({
      status: "reserved" as const,
      id: "reservation-a",
      remaining: 999,
    })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  return deps;
}
describe("translation authorization and reservation", () => {
  it("does not read text or contact provider when disabled", async () => {
    const d = dependencies();
    d.enabled = false;
    await expect(performTranslation(d, "operator", input)).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
    expect(d.authorize).not.toHaveBeenCalled();
    expect(d.provider.generate).not.toHaveBeenCalled();
  });
  it("requires consent before text access", async () => {
    const d = dependencies();
    await expect(
      performTranslation(d, "operator", { ...input, consent: false }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(d.resolveSource).not.toHaveBeenCalled();
  });
  it("rejects excluded plan before text or cache access", async () => {
    const d = dependencies();
    d.authorize = vi.fn(async () => ({ enabled: false, ownerUserId: "owner-a", monthlyLimit: 0 }));
    await expect(performTranslation(d, "operator", input)).rejects.toMatchObject({
      code: "TRANSLATION_NOT_INCLUDED",
    });
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.resolveSource).not.toHaveBeenCalled();
  });
  it("checks permissions even for cache hits", async () => {
    const d = dependencies();
    d.authorize = vi.fn(async () => {
      throw new Error("Access denied");
    });
    d.reserve = vi.fn(async () => ({
      status: "cached",
      translatedText: "Bonjour",
      remaining: 999,
    }));
    await expect(performTranslation(d, "operator", input)).rejects.toThrow("Access denied");
    expect(d.reserve).not.toHaveBeenCalled();
  });
  it("reuses cache without a provider request or quota completion", async () => {
    const d = dependencies();
    d.reserve = vi.fn(async () => ({
      status: "cached",
      translatedText: "Bonjour",
      remaining: 998,
    }));
    expect(await performTranslation(d, "operator", input)).toMatchObject({
      cached: true,
      remaining: 998,
      translatedText: "Bonjour",
    });
    expect(d.provider.generate).not.toHaveBeenCalled();
    expect(d.complete).not.toHaveBeenCalled();
  });
  it("does not repeat an in-flight provider request", async () => {
    const d = dependencies();
    d.reserve = vi.fn(async () => ({ status: "pending" }));
    await expect(performTranslation(d, "operator", input)).rejects.toMatchObject({
      code: "TRANSLATION_PENDING",
    });
    expect(d.provider.generate).not.toHaveBeenCalled();
  });
  it("retains reservation on ambiguous failure", async () => {
    const d = dependencies();
    d.provider.generate = vi.fn(async () => {
      throw new Error("Timeout");
    });
    await expect(performTranslation(d, "operator", input)).rejects.toThrow("Timeout");
    expect(d.fail).toHaveBeenCalledWith("reservation-a");
    expect(d.complete).not.toHaveBeenCalled();
  });
  it("binds source changes to a stable request ID separately from cache", async () => {
    const d = dependencies();
    await performTranslation(d, "operator", input);
    const first = vi.mocked(d.reserve).mock.calls[0][0];
    d.resolveSource = vi.fn(async () => "Goodbye");
    await performTranslation(d, "operator", input);
    const second = vi.mocked(d.reserve).mock.calls[1][0];
    expect(first.requestId).toBe(second.requestId);
    expect(first.requestBinding).not.toBe(second.requestBinding);
    expect(first.cacheKey).not.toBe(second.cacheKey);
  });
  it("scopes cache to the company and conversation", async () => {
    const d = dependencies();
    await performTranslation(d, "operator", input);
    await performTranslation(d, "operator", { ...input, workspaceId: "company-b" });
    await performTranslation(d, "operator", { ...input, conversationId: "chat-b" });
    const calls = vi.mocked(d.reserve).mock.calls.map((c) => c[0].cacheKey);
    expect(new Set(calls).size).toBe(3);
  });
  it("rejects empty cached translations", async () => {
    const d = dependencies();
    d.reserve = vi.fn(async () => ({ status: "cached", translatedText: " ", remaining: 999 }));
    await expect(performTranslation(d, "operator", input)).rejects.toMatchObject({
      code: "INVALID_CACHED_TRANSLATION",
    });
  });
});
