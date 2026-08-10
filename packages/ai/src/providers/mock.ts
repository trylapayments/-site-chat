import { createHash } from "node:crypto";

import { AIError } from "../types/errors";
import type {
  AIProvider,
  EmbeddingsRequest,
  EmbeddingsResult,
  GenerateOptions,
  GenerateRequest,
  GenerateResult,
  ModerateRequest,
  ModerateResult,
  StreamChunk,
} from "../types/provider";
import { collectStream } from "../streaming/collect";
import { throwIfAborted, withTimeout } from "./timeout";

export type MockProviderOptions = {
  model?: string;
  /**
   * Fixed suggestion text. When omitted, a deterministic draft is derived
   * from the last user/assistant turn so regenerate can change output when
   * the conversation (or a regenerate nonce in messages) changes.
   */
  fixedText?: string;
  streamDelayMs?: number;
  failWith?: AIError;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof AIError
          ? signal.reason
          : new AIError("AI_TIMEOUT", "AI request was cancelled or timed out."),
      );
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof AIError
          ? signal.reason
          : new AIError("AI_TIMEOUT", "AI request was cancelled or timed out."),
      );
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function deriveSuggestion(request: GenerateRequest): string {
  const lastContent =
    [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const visitorLines = lastContent.split("\n").filter((line) => line.startsWith("Visitor: "));
  const lastVisitor = visitorLines.at(-1)?.replace(/^Visitor:\s*/, "") ?? "";
  const seed = createHash("sha256").update(lastContent).digest("hex").slice(0, 8);

  if (lastVisitor) {
    return `Thanks for reaching out — I can help with that. Regarding “${lastVisitor.slice(0, 120)}”, could you share a bit more detail so I can assist accurately? (ref ${seed})`;
  }

  return `Thanks for your message. Happy to help — could you share a few more details about what you need? (ref ${seed})`;
}

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly metadata;

  private readonly fixedText: string | undefined;
  private readonly streamDelayMs: number;
  private readonly failWith: AIError | undefined;

  constructor(options: MockProviderOptions = {}) {
    const model = options.model ?? "mock-suggested-reply";
    this.metadata = {
      provider: "mock" as const,
      model,
      supportsStreaming: true,
      supportsEmbeddings: true,
      supportsModeration: true,
    };
    this.fixedText = options.fixedText;
    this.streamDelayMs = options.streamDelayMs ?? 0;
    this.failWith = options.failWith;
  }

  async generate(request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult> {
    return collectStream(this.stream(request, options));
  }

  async *stream(request: GenerateRequest, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.failWith) {
      throw this.failWith;
    }

    const text = this.fixedText ?? deriveSuggestion(request);
    const model = request.model ?? this.metadata.model;
    const chunks = text.match(/.{1,24}/g) ?? [text];
    let assembled = "";

    for (const chunk of chunks) {
      throwIfAborted(options?.signal);
      if (this.streamDelayMs > 0) {
        await withTimeout(sleep(this.streamDelayMs, options?.signal), {
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
        });
      } else {
        throwIfAborted(options?.signal);
      }
      assembled += chunk;
      yield { type: "delta", text: chunk };
    }

    const promptTokens = request.messages.reduce(
      (sum, message) => sum + Math.ceil(message.content.length / 4),
      0,
    );
    const completionTokens = Math.ceil(assembled.length / 4);

    yield {
      type: "done",
      text: assembled.trim(),
      model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: "stop",
    };
  }

  embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResult> {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    return Promise.resolve({
      model: request.model ?? "mock-embeddings",
      vectors: inputs.map((value) => {
        const digest = createHash("sha256").update(value).digest();
        return Array.from(digest.subarray(0, 8), (byte: number) => byte / 255);
      }),
      usage: {
        promptTokens: inputs.reduce((sum, value) => sum + Math.ceil(value.length / 4), 0),
        completionTokens: 0,
        totalTokens: inputs.reduce((sum, value) => sum + Math.ceil(value.length / 4), 0),
      },
    });
  }

  moderate(request: ModerateRequest): Promise<ModerateResult> {
    const flagged = /ignore previous instructions/i.test(request.input);
    return Promise.resolve({
      flagged,
      categories: {
        prompt_injection_heuristic: flagged,
      },
    });
  }
}
