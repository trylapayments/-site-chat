import { AIError } from "../types/errors";
import type { GenerateResult, StreamChunk, TokenUsage } from "../types/provider";

export async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<GenerateResult> {
  let text = "";
  let model = "";
  let usage: TokenUsage = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };
  let finishReason: GenerateResult["finishReason"] = "unknown";
  let sawDone = false;

  for await (const chunk of stream) {
    if (chunk.type === "delta") {
      text += chunk.text;
      continue;
    }

    sawDone = true;
    text = chunk.text || text;
    model = chunk.model;
    usage = chunk.usage;
    finishReason = chunk.finishReason;
  }

  if (!sawDone) {
    throw new AIError("AI_INVALID_RESPONSE", "Stream ended without a completion chunk.");
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new AIError("AI_INVALID_RESPONSE", "Provider returned empty suggestion text.");
  }

  return {
    text: trimmed,
    model,
    usage,
    finishReason,
  };
}
