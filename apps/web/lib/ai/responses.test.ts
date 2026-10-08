import { describe, expect, it, vi } from "vitest";

import {
  AI_REQUEST_BODY_MAX_BYTES,
  encodeSseEvent,
  readBoundedJsonBody,
  readBoundedRequestText,
  requireJsonContentType,
} from "./responses";

function chunkedBody(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(parts[index]));
      index += 1;
    },
  });
}

describe("AI HTTP helpers", () => {
  it("requires application/json content type", () => {
    expect(
      requireJsonContentType(
        new Request("http://localhost", {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).toBe(true);
    expect(
      requireJsonContentType(
        new Request("http://localhost", {
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    ).toBe(false);
  });

  it("bounds SSE delta and error message sizes", () => {
    const delta = encodeSseEvent({
      type: "delta",
      text: "x".repeat(5_000),
    });
    expect(delta.length).toBeLessThan(5_000);

    const error = encodeSseEvent({
      type: "error",
      code: "AI_PROVIDER_ERROR",
      message: "y".repeat(2_000),
    });
    const payload = JSON.parse(error.replace(/^data:\s*/, "").trim()) as {
      message: string;
    };
    expect(payload.message.length).toBeLessThanOrEqual(500);
  });

  it("accepts a valid JSON body below the limit", async () => {
    const result = await readBoundedJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "11111111-1111-4111-8111-111111111111",
          conversationId: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({
        workspaceId: "11111111-1111-4111-8111-111111111111",
      });
    }
  });

  it("rejects when Content-Length is above the limit without buffering the body", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const request = {
      headers: new Headers({
        "content-length": String(AI_REQUEST_BODY_MAX_BYTES + 1),
      }),
      body: { cancel },
    } as unknown as Request;

    const result = await readBoundedRequestText(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
    }
    expect(cancel).toHaveBeenCalled();
  });

  it("stops reading an oversized chunked body without Content-Length", async () => {
    const chunk = "x".repeat(2_000);
    const parts = Array.from({ length: 6 }, () => chunk);
    const result = await readBoundedRequestText(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: chunkedBody(parts),
        // Node fetch requires duplex when sending a stream body.
        duplex: "half",
      } as RequestInit),
      4_000,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
    }
  });

  it("rejects malformed JSON under the size limit", async () => {
    const result = await readBoundedJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"broken"',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toMatch(/invalid request body/i);
    }
  });

  it("rejects oversized JSON bodies without Content-Length", async () => {
    const oversized = `{"a":"${"x".repeat(AI_REQUEST_BODY_MAX_BYTES)}"}`;
    const result = await readBoundedJsonBody(
      new Request("http://localhost", {
        method: "POST",
        body: oversized,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
    }
  });
});
