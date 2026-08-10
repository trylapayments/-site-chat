import { describe, expect, it } from "vitest";

import { AIError } from "../types/errors";
import { createAIProvider } from "./create-provider";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";

describe("createAIProvider", () => {
  it("creates mock and openai providers from configuration", () => {
    expect(createAIProvider({ provider: "mock" })).toBeInstanceOf(MockProvider);
    expect(
      createAIProvider({
        provider: "openai",
        credentials: { openaiApiKey: "sk-test" },
      }),
    ).toBeInstanceOf(OpenAIProvider);
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
