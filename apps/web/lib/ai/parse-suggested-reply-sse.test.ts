import { describe, expect, it, vi } from "vitest";

import {
  parseSuggestedReplySseData,
  readSuggestedReplySse,
} from "./parse-suggested-reply-sse";

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("parseSuggestedReplySseData", () => {
  it("parses events through the shared schema", () => {
    expect(
      parseSuggestedReplySseData(
        JSON.stringify({ type: "delta", text: "Hello" }),
      ),
    ).toEqual({ type: "delta", text: "Hello" });

    expect(
      parseSuggestedReplySseData(JSON.stringify({ type: "cancelled" })),
    ).toEqual({ type: "cancelled" });

    expect(
      parseSuggestedReplySseData(
        JSON.stringify({ type: "delta", text: "x".repeat(2001) }),
      ),
    ).toBeNull();
  });
});

describe("readSuggestedReplySse", () => {
  it("returns cancelled when the request identity becomes stale", async () => {
    let current = true;
    const response = sseResponse([
      { type: "delta", text: "Hi" },
      {
        type: "done",
        suggestion: "Hi there",
        model: "m",
        provider: "mock",
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
        },
      },
    ]);

    const onDelta = vi.fn(() => {
      current = false;
    });

    const result = await readSuggestedReplySse(response, {
      onDelta,
      isCurrent: () => current,
    });

    expect(result).toEqual({ kind: "cancelled" });
  });

  it("returns suggestion for the current request", async () => {
    const response = sseResponse([
      { type: "delta", text: "Thanks" },
      {
        type: "done",
        suggestion: "Thanks for writing in.",
        model: "mock-suggested-reply",
        provider: "mock",
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
        },
      },
    ]);

    const result = await readSuggestedReplySse(response, {
      onDelta: () => undefined,
      isCurrent: () => true,
    });

    expect(result).toEqual({
      kind: "suggestion",
      suggestion: "Thanks for writing in.",
    });
  });

  it("maps AI_CANCELLED stream errors to cancelled", async () => {
    const response = sseResponse([
      {
        type: "error",
        code: "AI_CANCELLED",
        message: "The AI request was cancelled.",
      },
    ]);

    const result = await readSuggestedReplySse(response, {
      onDelta: () => undefined,
      isCurrent: () => true,
    });

    expect(result).toEqual({ kind: "cancelled" });
  });
});
