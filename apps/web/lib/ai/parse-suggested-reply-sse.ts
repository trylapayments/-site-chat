import {
  suggestedReplyStreamEventSchema,
  type SuggestedReplyStreamEvent,
} from "@site-chat/shared";

export type ParsedSuggestedReplyStreamResult =
  | { kind: "suggestion"; suggestion: string }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

/**
 * Parse one SSE `data:` JSON payload with the shared schema.
 * Rejects oversized / malformed events instead of trusting ad-hoc shapes.
 */
export function parseSuggestedReplySseData(
  raw: string,
): SuggestedReplyStreamEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  const parsed = suggestedReplyStreamEventSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function readSuggestedReplySse(
  response: Response,
  options: {
    onDelta: (assembled: string) => void;
    isCurrent: () => boolean;
    signal?: AbortSignal;
  },
): Promise<ParsedSuggestedReplyStreamResult> {
  if (!response.body) {
    return { kind: "error", message: "AI is temporarily unavailable." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

  try {
    for (;;) {
      if (options.signal?.aborted || !options.isCurrent()) {
        return { kind: "cancelled" };
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part
          .split("\n")
          .map((entry) => entry.trim())
          .find((entry) => entry.startsWith("data:"));
        if (!line) {
          continue;
        }

        const event = parseSuggestedReplySseData(line.slice(5).trim());
        if (!event) {
          return {
            kind: "error",
            message: "The AI provider returned an invalid response.",
          };
        }

        if (!options.isCurrent()) {
          return { kind: "cancelled" };
        }

        switch (event.type) {
          case "delta":
            assembled += event.text;
            options.onDelta(assembled);
            break;
          case "done":
            return { kind: "suggestion", suggestion: event.suggestion };
          case "cancelled":
            return { kind: "cancelled" };
          case "error":
            if (event.code === "AI_CANCELLED") {
              return { kind: "cancelled" };
            }
            return { kind: "error", message: event.message };
          default: {
            const _exhaustive: never = event;
            return {
              kind: "error",
              message: `Unexpected stream event: ${String(_exhaustive)}`,
            };
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  if (!options.isCurrent() || options.signal?.aborted) {
    return { kind: "cancelled" };
  }

  if (assembled.trim()) {
    return { kind: "suggestion", suggestion: assembled.trim() };
  }

  return { kind: "error", message: "AI is temporarily unavailable." };
}
