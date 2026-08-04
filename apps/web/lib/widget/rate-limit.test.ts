import { describe, expect, it } from "vitest";

import { hashClientIp, hashRateLimitKey } from "@/lib/widget/rate-limit";

describe("rate limit hashing", () => {
  it("hashes identifiers without exposing raw values", () => {
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-min-32-characters";

    const hashed = hashClientIp("203.0.113.10");
    expect(hashed).not.toContain("203.0.113.10");
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces stable bucket keys for the same scope", () => {
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-min-32-characters";

    expect(hashRateLimitKey("session", "abc")).toBe(
      hashRateLimitKey("session", "abc"),
    );
    expect(hashRateLimitKey("session", "abc")).not.toBe(
      hashRateLimitKey("session", "def"),
    );
  });
});
