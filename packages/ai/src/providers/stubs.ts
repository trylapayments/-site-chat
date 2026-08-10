import { AIError } from "../types/errors";
import type {
  AIProvider,
  AIProviderId,
  EmbeddingsRequest,
  EmbeddingsResult,
  GenerateOptions,
  GenerateRequest,
  GenerateResult,
  ModerateRequest,
  ModerateResult,
  StreamChunk,
} from "../types/provider";

/**
 * Interface-only stubs for providers that are not implemented yet.
 * Instantiation is allowed for configuration validation; every method
 * fails closed with AI_UNAVAILABLE.
 */
abstract class UnimplementedProvider implements AIProvider {
  abstract readonly id: AIProviderId;
  abstract readonly metadata: AIProvider["metadata"];

  generate(_request: GenerateRequest, _options?: GenerateOptions): Promise<GenerateResult> {
    return Promise.reject(this.unavailable());
  }

  stream(_request: GenerateRequest, _options?: GenerateOptions): AsyncIterable<StreamChunk> {
    const error = this.unavailable();
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(error);
          },
        };
      },
    };
  }

  embeddings(_request: EmbeddingsRequest, _options?: GenerateOptions): Promise<EmbeddingsResult> {
    return Promise.reject(this.unavailable());
  }

  moderate(_request: ModerateRequest, _options?: GenerateOptions): Promise<ModerateResult> {
    return Promise.reject(this.unavailable());
  }

  private unavailable(): AIError {
    return new AIError("AI_UNAVAILABLE", `Provider "${this.id}" is not implemented.`, {
      status: 501,
      retryable: false,
    });
  }
}

export class AnthropicProviderStub extends UnimplementedProvider {
  readonly id = "anthropic" as const;
  readonly metadata = {
    provider: "anthropic" as const,
    model: "claude-stub",
    supportsStreaming: true,
    supportsEmbeddings: false,
    supportsModeration: false,
  };
}

export class GeminiProviderStub extends UnimplementedProvider {
  readonly id = "gemini" as const;
  readonly metadata = {
    provider: "gemini" as const,
    model: "gemini-stub",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsModeration: false,
  };
}

export class OllamaProviderStub extends UnimplementedProvider {
  readonly id = "ollama" as const;
  readonly metadata = {
    provider: "ollama" as const,
    model: "ollama-stub",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsModeration: false,
  };
}
