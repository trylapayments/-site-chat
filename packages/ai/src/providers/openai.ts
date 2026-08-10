import { AIError } from "../types/errors";
import type {
  AIChatMessage,
  AIProvider,
  EmbeddingsRequest,
  EmbeddingsResult,
  GenerateOptions,
  GenerateRequest,
  GenerateResult,
  ModerateRequest,
  ModerateResult,
  StreamChunk,
  TokenUsage,
} from "../types/provider";
import { collectStream } from "../streaming/collect";
import { abortErrorForSignal, combineAbortSignals, throwIfAborted } from "./timeout";

export type OpenAIProviderOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
};

type OpenAIChatCompletion = {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type OpenAIChatChunk = {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function mapUsage(usage: OpenAIChatCompletion["usage"]): TokenUsage {
  if (!usage) {
    return {
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    };
  }

  return {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

function mapFinishReason(reason: string | null | undefined): GenerateResult["finishReason"] {
  if (reason === "stop" || reason === "length" || reason === "content_filter") {
    return reason;
  }
  return "unknown";
}

function toOpenAIMessages(messages: AIChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function mapProviderHttpError(status: number): AIError {
  if (status === 429) {
    return new AIError("AI_RATE_LIMITED", "Provider rate limited the request.", {
      status: 429,
      retryable: true,
    });
  }

  if (status === 408 || status === 504) {
    return new AIError("AI_TIMEOUT", "Provider timed out.", {
      status: 504,
      retryable: true,
    });
  }

  return new AIError("AI_PROVIDER_ERROR", "Provider request failed.", {
    status: 503,
    retryable: status >= 500,
  });
}

async function readErrorSafe(response: Response): Promise<void> {
  // Intentionally discard upstream bodies — never leak raw provider errors.
  try {
    await response.arrayBuffer();
  } catch {
    // ignore
  }
}

function mapAbortError(signal: AbortSignal | undefined, error: unknown): AIError {
  return abortErrorForSignal(signal, error);
}

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly metadata;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) {
      throw new AIError("AI_NOT_CONFIGURED", "OpenAI API key is not configured.");
    }

    const model = options.model ?? "gpt-4o-mini";
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.metadata = {
      provider: "openai" as const,
      model,
      supportsStreaming: true,
      supportsEmbeddings: true,
      supportsModeration: true,
    };
  }

  async generate(request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult> {
    return collectStream(this.stream(request, options));
  }

  async *stream(request: GenerateRequest, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    const model = request.model ?? this.metadata.model;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup } = combineAbortSignals(options?.signal, timeoutMs);

    try {
      throwIfAborted(signal);

      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: toOpenAIMessages(request.messages),
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxOutputTokens ?? 400,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });

      if (!response.ok) {
        await readErrorSafe(response);
        throw mapProviderHttpError(response.status);
      }

      if (!response.body) {
        throw new AIError("AI_INVALID_RESPONSE", "Provider returned an empty stream body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";
      let usage: TokenUsage = {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      };
      let finishReason: GenerateResult["finishReason"] = "unknown";
      let responseModel = model;

      try {
        for (;;) {
          throwIfAborted(signal);
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) {
              continue;
            }

            const payload = line.slice(5).trim();
            if (!payload) {
              continue;
            }
            if (payload === "[DONE]") {
              continue;
            }

            let parsed: OpenAIChatChunk;
            try {
              parsed = JSON.parse(payload) as OpenAIChatChunk;
            } catch {
              throw new AIError("AI_INVALID_RESPONSE", "Provider returned malformed stream data.");
            }

            if (parsed.model) {
              responseModel = parsed.model;
            }
            if (parsed.usage) {
              usage = mapUsage(parsed.usage);
            }

            const choice = parsed.choices?.[0];
            const delta = choice?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              assembled += delta;
              yield { type: "delta", text: delta };
            }
            if (choice?.finish_reason) {
              finishReason = mapFinishReason(choice.finish_reason);
            }
          }
        }
      } finally {
        // Cancel the upstream reader when the consumer stops early or aborts,
        // so the transport can stop pulling tokens where the provider allows it.
        try {
          await reader.cancel();
        } catch {
          // ignore cancel races
        }
      }

      const text = assembled.trim();
      if (!text) {
        throw new AIError("AI_INVALID_RESPONSE", "Provider returned empty suggestion text.");
      }

      yield {
        type: "done",
        text,
        model: responseModel,
        usage,
        finishReason,
      };
    } catch (error) {
      if (error instanceof AIError) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        throw mapAbortError(signal, error);
      }
      throw new AIError("AI_PROVIDER_ERROR", "Provider request failed.", {
        cause: error,
      });
    } finally {
      cleanup();
    }
  }

  async embeddings(
    request: EmbeddingsRequest,
    options?: GenerateOptions,
  ): Promise<EmbeddingsResult> {
    const model = request.model ?? "text-embedding-3-small";
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup } = combineAbortSignals(options?.signal, timeoutMs);

    try {
      throwIfAborted(signal);
      const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: request.input,
        }),
        signal,
      });

      if (!response.ok) {
        await readErrorSafe(response);
        throw mapProviderHttpError(response.status);
      }

      const json = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
        usage?: OpenAIChatCompletion["usage"];
        model?: string;
      };

      const vectors =
        json.data
          ?.map((item) => item.embedding)
          .filter((item): item is number[] => Array.isArray(item)) ?? [];

      if (vectors.length === 0) {
        throw new AIError("AI_INVALID_RESPONSE", "Provider returned no embeddings.");
      }

      return {
        model: json.model ?? model,
        vectors,
        usage: mapUsage(json.usage),
      };
    } catch (error) {
      if (error instanceof AIError) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        throw mapAbortError(signal, error);
      }
      throw new AIError("AI_PROVIDER_ERROR", "Provider request failed.", {
        cause: error,
      });
    } finally {
      cleanup();
    }
  }

  async moderate(request: ModerateRequest, options?: GenerateOptions): Promise<ModerateResult> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup } = combineAbortSignals(options?.signal, timeoutMs);

    try {
      throwIfAborted(signal);
      const response = await this.fetchImpl(`${this.baseUrl}/moderations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: request.input,
        }),
        signal,
      });

      if (!response.ok) {
        await readErrorSafe(response);
        throw mapProviderHttpError(response.status);
      }

      const json = (await response.json()) as {
        results?: Array<{
          flagged?: boolean;
          categories?: Record<string, boolean>;
        }>;
      };

      const result = json.results?.[0];
      return {
        flagged: result?.flagged === true,
        categories: result?.categories ?? {},
      };
    } catch (error) {
      if (error instanceof AIError) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        throw mapAbortError(signal, error);
      }
      throw new AIError("AI_PROVIDER_ERROR", "Provider request failed.", {
        cause: error,
      });
    } finally {
      cleanup();
    }
  }

  /** Non-streaming helper used by tests for response mapping. */
  async generateOnce(request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult> {
    const model = request.model ?? this.metadata.model;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup } = combineAbortSignals(options?.signal, timeoutMs);

    try {
      throwIfAborted(signal);
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: toOpenAIMessages(request.messages),
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxOutputTokens ?? 400,
          stream: false,
        }),
        signal,
      });

      if (!response.ok) {
        await readErrorSafe(response);
        throw mapProviderHttpError(response.status);
      }

      const json = (await response.json()) as OpenAIChatCompletion;
      const text = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        throw new AIError("AI_INVALID_RESPONSE", "Provider returned empty suggestion text.");
      }

      return {
        text,
        model: json.model ?? model,
        usage: mapUsage(json.usage),
        finishReason: mapFinishReason(json.choices?.[0]?.finish_reason),
      };
    } catch (error) {
      if (error instanceof AIError) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        throw mapAbortError(signal, error);
      }
      throw new AIError("AI_PROVIDER_ERROR", "Provider request failed.", {
        cause: error,
      });
    } finally {
      cleanup();
    }
  }
}
