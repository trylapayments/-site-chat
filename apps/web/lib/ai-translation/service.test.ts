import { describe, expect, it, vi } from "vitest";
import {
  performTranslation,
  type TranslationDependencies,
  type TranslationInput,
} from "./service";
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
  const generateMock = vi
    .fn<TranslationDependencies["provider"]["generate"]>()
    .mockResolvedValue({
      text: "Bonjour",
      finishReason: "stop",
      model: "gpt-4o-mini",
      usage: { promptTokens: 100, completionTokens: 2, totalTokens: 102 },
    });
  const deps: TranslationDependencies = {
    enabled: true,
    provider: {
      id: "openai",
      metadata: { provider: "openai", model: "gpt-4o-mini" },
      generate: generateMock,
    } as unknown as TranslationDependencies["provider"],
    authorize: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        ownerUserId: "owner-a",
        monthlyLimit: 1000,
      }),
    ),
    resolveSource: vi.fn(() =>
      Promise.resolve(input.mode === "draft" ? input.text : ""),
    ),
    reserve: vi.fn(() =>
      Promise.resolve({
        status: "reserved" as const,
        id: "reservation-a",
        remaining: 999,
      }),
    ),
    complete: vi.fn(() => Promise.resolve()),
    fail: vi.fn(() => Promise.resolve()),
  };
  return { ...deps, generateMock };
}
describe("translation authorization and reservation", () => {
  it("does not read text or contact provider when disabled", async () => {
    const d = dependencies();
    d.enabled = false;
    await expect(
      performTranslation(d, "operator", input),
    ).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
    expect(d.authorize).not.toHaveBeenCalled();
    expect(d.generateMock).not.toHaveBeenCalled();
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
    d.authorize = vi.fn(() =>
      Promise.resolve({
        enabled: false,
        ownerUserId: "owner-a",
        monthlyLimit: 0,
      }),
    );
    await expect(
      performTranslation(d, "operator", input),
    ).rejects.toMatchObject({
      code: "TRANSLATION_NOT_INCLUDED",
    });
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.resolveSource).not.toHaveBeenCalled();
  });
  it("checks permissions even for cache hits", async () => {
    const d = dependencies();
    d.authorize = vi.fn(() => Promise.reject(new Error("Access denied")));
    d.reserve = vi.fn(() =>
      Promise.resolve({
        status: "cached" as const,
        translatedText: "Bonjour",
        remaining: 999,
      }),
    );
    await expect(performTranslation(d, "operator", input)).rejects.toThrow(
      "Access denied",
    );
    expect(d.reserve).not.toHaveBeenCalled();
  });
  it("reuses cache without a provider request or quota completion", async () => {
    const d = dependencies();
    d.reserve = vi.fn(() =>
      Promise.resolve({
        status: "cached" as const,
        translatedText: "Bonjour",
        remaining: 998,
      }),
    );
    expect(await performTranslation(d, "operator", input)).toMatchObject({
      cached: true,
      remaining: 998,
      translatedText: "Bonjour",
    });
    expect(d.generateMock).not.toHaveBeenCalled();
    expect(d.complete).not.toHaveBeenCalled();
  });
  it("does not repeat an in-flight provider request", async () => {
    const d = dependencies();
    d.reserve = vi.fn(() => Promise.resolve({ status: "pending" as const }));
    await expect(
      performTranslation(d, "operator", input),
    ).rejects.toMatchObject({
      code: "TRANSLATION_PENDING",
    });
    expect(d.generateMock).not.toHaveBeenCalled();
  });
  it("retains reservation on ambiguous failure", async () => {
    const d = dependencies();
    d.provider.generate = vi.fn(() => Promise.reject(new Error("Timeout")));
    await expect(performTranslation(d, "operator", input)).rejects.toThrow(
      "Timeout",
    );
    expect(d.fail).toHaveBeenCalledWith("reservation-a");
    expect(d.complete).not.toHaveBeenCalled();
  });
  it("binds source changes to a stable request ID separately from cache", async () => {
    const d = dependencies();
    await performTranslation(d, "operator", input);
    const first = vi.mocked(d.reserve).mock.calls[0]?.[0];
    d.resolveSource = vi.fn(() => Promise.resolve("Goodbye"));
    await performTranslation(d, "operator", input);
    const second = vi.mocked(d.reserve).mock.calls[1]?.[0];
    if (!first || !second) throw new Error("Expected two reservation calls");
    expect(first.requestId).toBe(second.requestId);
    expect(first.requestBinding).not.toBe(second.requestBinding);
    expect(first.cacheKey).not.toBe(second.cacheKey);
  });
  it("scopes cache to the company and conversation", async () => {
    const d = dependencies();
    await performTranslation(d, "operator", input);
    await performTranslation(d, "operator", {
      ...input,
      workspaceId: "company-b",
    });
    await performTranslation(d, "operator", {
      ...input,
      conversationId: "chat-b",
    });
    const calls = vi.mocked(d.reserve).mock.calls.map((c) => c[0].cacheKey);
    expect(new Set(calls).size).toBe(3);
  });
  it("rejects empty cached translations", async () => {
    const d = dependencies();
    d.reserve = vi.fn(() =>
      Promise.resolve({
        status: "cached" as const,
        translatedText: " ",
        remaining: 999,
      }),
    );
    await expect(
      performTranslation(d, "operator", input),
    ).rejects.toMatchObject({
      code: "INVALID_CACHED_TRANSLATION",
    });
  });
});

it("detects source language and translates with one quota reservation", async () => {
  const d = dependencies();
  d.generateMock.mockResolvedValue({ text: JSON.stringify({ text: "Bonjour", sourceLanguage: "en" }), finishReason: "stop", model: "gpt-4o-mini", usage: { promptTokens: 12, completionTokens: 10, totalTokens: 22 } });
  expect(await performTranslation(d, "operator", { ...input, withSourceLanguage: true })).toMatchObject({ translatedText: "Bonjour", sourceLanguage: "en", remaining: 999 });
  expect(d.generateMock).toHaveBeenCalledTimes(1);
  expect(d.reserve).toHaveBeenCalledTimes(1);
  expect(d.complete).toHaveBeenCalledWith("reservation-a", expect.objectContaining({ translatedText: JSON.stringify({ original: "Hello", text: "Bonjour", sourceLanguage: "en" }) }));
});
it("restores source metadata from cache without another provider call", async () => {
  const d = dependencies();
  d.reserve = vi.fn(() => Promise.resolve({ status: "cached" as const, translatedText: JSON.stringify({ text: "Bonjour", sourceLanguage: "en" }), remaining: 997 }));
  expect(await performTranslation(d, "operator", { ...input, withSourceLanguage: true })).toMatchObject({ translatedText: "Bonjour", sourceLanguage: "en", cached: true });
  expect(d.generateMock).not.toHaveBeenCalled();
});
it("does not send or cache malformed source detection", async () => {
  const d = dependencies();
  d.generateMock.mockResolvedValue({ text: "Bonjour", finishReason: "stop", model: "gpt-4o-mini", usage: { promptTokens: 12, completionTokens: 10, totalTokens: 22 } });
  await expect(performTranslation(d, "operator", { ...input, withSourceLanguage: true })).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  expect(d.complete).not.toHaveBeenCalled();
  expect(d.fail).toHaveBeenCalledOnce();
});
