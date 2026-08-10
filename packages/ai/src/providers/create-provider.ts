import { AIError } from "../types/errors";
import type { AIProvider, AIProviderId } from "../types/provider";
import { MockProvider, type MockProviderOptions } from "./mock";
import { OpenAIProvider, type OpenAIProviderOptions } from "./openai";
import { AnthropicProviderStub, GeminiProviderStub, OllamaProviderStub } from "./stubs";

export type ProviderCredentials = {
  openaiApiKey?: string | null;
};

export type CreateProviderOptions = {
  provider: AIProviderId;
  model?: string;
  credentials?: ProviderCredentials;
  openai?: Omit<OpenAIProviderOptions, "apiKey" | "model">;
  mock?: MockProviderOptions;
  /**
   * When true, unimplemented providers return stubs that fail on use.
   * When false (default for runtime), selecting them throws AI_NOT_CONFIGURED.
   */
  allowUnimplementedStubs?: boolean;
  /**
   * Explicitly allow MockProvider. Required in production unless NODE_ENV=test
   * or AI_ALLOW_MOCK_PROVIDER=true.
   */
  allowMockProvider?: boolean;
};

function isMockProviderAllowed(explicitAllow: boolean | undefined): boolean {
  if (explicitAllow === true) {
    return true;
  }
  if (process.env.AI_ALLOW_MOCK_PROVIDER === "true") {
    return true;
  }
  // Vitest / automated tests may select mock without production risk.
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

export function createAIProvider(options: CreateProviderOptions): AIProvider {
  switch (options.provider) {
    case "mock":
      if (!isMockProviderAllowed(options.allowMockProvider)) {
        throw new AIError(
          "AI_NOT_CONFIGURED",
          "Mock AI provider is not allowed in this environment.",
          { status: 403, retryable: false },
        );
      }
      return new MockProvider({
        ...options.mock,
        model: options.model ?? options.mock?.model,
      });
    case "openai": {
      const apiKey = options.credentials?.openaiApiKey;
      if (!apiKey) {
        throw new AIError("AI_NOT_CONFIGURED", "OpenAI API key is not configured.");
      }
      return new OpenAIProvider({
        apiKey,
        model: options.model,
        ...options.openai,
      });
    }
    case "anthropic":
      if (options.allowUnimplementedStubs) {
        return new AnthropicProviderStub();
      }
      throw new AIError("AI_NOT_CONFIGURED", "Anthropic provider is not available yet.", {
        status: 501,
        retryable: false,
      });
    case "gemini":
      if (options.allowUnimplementedStubs) {
        return new GeminiProviderStub();
      }
      throw new AIError("AI_NOT_CONFIGURED", "Gemini provider is not available yet.", {
        status: 501,
        retryable: false,
      });
    case "ollama":
      if (options.allowUnimplementedStubs) {
        return new OllamaProviderStub();
      }
      throw new AIError("AI_NOT_CONFIGURED", "Ollama provider is not available yet.", {
        status: 501,
        retryable: false,
      });
    default:
      throw new AIError("AI_NOT_CONFIGURED", "Unknown AI provider.");
  }
}
