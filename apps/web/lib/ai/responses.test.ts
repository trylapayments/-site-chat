import { describe, expect, it } from "vitest";

import {
  AI_REQUEST_BODY_MAX_BYTES,
  encodeSseEvent,
  readBoundedJsonBody,
  requireJsonContentType,
} from "./responses";

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

  it("rejects oversized JSON bodies", async () => {
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
