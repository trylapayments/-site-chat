import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_PROVIDER_IDS } from "../types/provider";
import { AIError } from "../types/errors";
import { createAIProvider } from "./create-provider";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";

describe("createAIProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates mock and openai providers from configuration", () => {
    expect(createAIProvider({ provider: "mock" })).toBeInstanceOf(MockProvider);
    expect(
      createAIProvider({
        provider: "openai",
        credentials: { openaiApiKey: "sk-test" },
      }),
    ).toBeInstanceOf(OpenAIProvider);
  });

  it("keeps provider ids aligned with the shared API contract set", () => {
    expect([...AI_PROVIDER_IDS]).toEqual(["openai", "mock", "anthropic", "gemini", "ollama"]);
  });

  it("blocks MockProvider in production unless explicitly allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_ALLOW_MOCK_PROVIDER", "false");
    vi.stubEnv("VITEST", "");

    expect(() => createAIProvider({ provider: "mock" })).toThrowError(/not allowed/i);

    expect(createAIProvider({ provider: "mock", allowMockProvider: true })).toBeInstanceOf(
      MockProvider,
    );
  });

  it("fails closed when openai key is missing", () => {
    try {
      createAIProvider({ provider: "openai" });
      expect.fail("expected createAIProvider to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect((error as AIError).code).toBe("AI_NOT_CONFIGURED");
    }
  });

  it("rejects unimplemented providers unless stubs are allowed", async () => {
    try {
      createAIProvider({ provider: "anthropic" });
      expect.fail("expected createAIProvider to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect((error as AIError).code).toBe("AI_NOT_CONFIGURED");
    }

    const stub = createAIProvider({
      provider: "anthropic",
      allowUnimplementedStubs: true,
    });

    await expect(
      stub.generate({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});
