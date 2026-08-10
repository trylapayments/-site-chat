/**
 * Canonical provider ids. Keep identical to `@site-chat/shared` AI_PROVIDER_IDS
 * (asserted in create-provider tests) — shared owns the API contract enum.
 */
export const AI_PROVIDER_IDS = ["openai", "mock", "anthropic", "gemini", "ollama"] as const;

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AIRole = "system" | "user" | "assistant";

export type AIChatMessage = {
  role: AIRole;
  content: string;
};

export type TokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type ModelMetadata = {
  provider: AIProviderId;
  model: string;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  supportsModeration: boolean;
};

export type GenerateRequest = {
  messages: AIChatMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Opaque request id for correlation / cancellation.
   * Never includes prompt content.
   */
  requestId?: string;
  /**
   * Server-generated opaque regenerate entropy.
   * Must never be interpolated into prompt messages.
   */
  regenerateSeed?: string;
};

export type GenerateOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type GenerateResult = {
  text: string;
  model: string;
  usage: TokenUsage;
  finishReason: "stop" | "length" | "content_filter" | "unknown";
};

export type StreamChunk =
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "done";
      text: string;
      model: string;
      usage: TokenUsage;
      finishReason: GenerateResult["finishReason"];
    };

export type EmbeddingsRequest = {
  input: string | string[];
  model?: string;
};

export type EmbeddingsResult = {
  model: string;
  vectors: number[][];
  usage: TokenUsage;
};

export type ModerateRequest = {
  input: string;
};

export type ModerateResult = {
  flagged: boolean;
  categories: Record<string, boolean>;
};

/**
 * Provider contract. Streaming is first-class; generate() may be
 * implemented via stream aggregation when convenient.
 * Cancellation/timeout options apply to every method.
 */
export interface AIProvider {
  readonly id: AIProviderId;
  readonly metadata: ModelMetadata;

  generate(request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult>;

  stream(request: GenerateRequest, options?: GenerateOptions): AsyncIterable<StreamChunk>;

  embeddings(request: EmbeddingsRequest, options?: GenerateOptions): Promise<EmbeddingsResult>;

  moderate(request: ModerateRequest, options?: GenerateOptions): Promise<ModerateResult>;
}
