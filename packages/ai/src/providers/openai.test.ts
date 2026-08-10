import { describe, expect, it, vi } from "vitest";

import { OpenAIProvider } from "./openai";

function sseResponse(lines: string[]): Response {
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("OpenAIProvider", () => {
  it("maps streamed deltas and usage", async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          `data: ${JSON.stringify({
            model: "gpt-4o-mini",
            choices: [{ delta: { content: "Hello" } }],
          })}`,
          `data: ${JSON.stringify({
            choices: [{ delta: { content: " world" }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 2,
              total_tokens: 13,
            },
          })}`,
          "data: [DONE]",
        ]),
      ),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider.generate({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 2,
      totalTokens: 13,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const firstCall = vi.mocked(fetchImpl).mock.calls[0];
    expect(firstCall).toBeDefined();
    const init = firstCall?.[1];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
  });

  it("maps non-stream completions via generateOnce", async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          model: "gpt-4o-mini",
          choices: [{ message: { content: "Suggested reply" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 3,
            total_tokens: 8,
          },
        }),
      ),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider.generateOnce({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result).toMatchObject({
      text: "Suggested reply",
      finishReason: "stop",
      usage: {
        promptTokens: 5,
        completionTokens: 3,
        totalTokens: 8,
      },
    });
  });

  it("maps provider HTTP errors without leaking bodies", async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "secret upstream" } }), {
          status: 500,
        }),
      ),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(
      provider.generate({ messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_ERROR",
      message: "Provider request failed.",
    });
  });

  it("maps timeout aborts to AI_TIMEOUT", async () => {
    const fetchImpl: typeof fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
      defaultTimeoutMs: 5,
    });

    await expect(
      provider.generate({ messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT" });
  });

  it("maps caller AbortSignal to AI_CANCELLED, not AI_TIMEOUT", async () => {
    const fetchImpl: typeof fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
      defaultTimeoutMs: 30_000,
    });
    const controller = new AbortController();
    const pending = provider.generate(
      { messages: [{ role: "user", content: "Hi" }] },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "AI_CANCELLED" });
  });

  it("cancels the stream reader on early consumer termination", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "Hello" } }],
            })}\n\n`,
          ),
        );
      },
      cancel() {
        cancelCalls += 1;
      },
    });

    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const iterator = provider
      .stream({
        messages: [{ role: "user", content: "Hi" }],
      })
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "delta", text: "Hello" });
    await iterator.return?.();

    expect(cancelCalls).toBeGreaterThanOrEqual(1);
  });

  it("handles null usage safely", async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "Ok" }, finish_reason: "stop" }],
          })}`,
          "data: [DONE]",
        ]),
      ),
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider.generate({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });
});
