import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  createRecoveryCookiePayload,
  createRecoveryCookieValue,
  getRecoveryCookieOptions,
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
  RECOVERY_COOKIE_PURPOSE,
  recoveryCookiePayloadContainsForbiddenData,
  verifyRecoveryCookieValue,
} from "@/lib/auth/recovery-cookie";
import { setRecoveryCookieOnResponse } from "@/lib/auth/recovery-cookie.server";

const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";
const NOW = 1_700_000_000;

vi.mock("@/lib/env", () => ({
  env: {
    AUTH_COOKIE_SECRET: "test-auth-cookie-secret-min-32-characters",
    NODE_ENV: "test",
  },
}));

describe("recovery cookie payload", () => {
  it("contains only purpose, issued_at, expires_at, and nonce", () => {
    const payload = createRecoveryCookiePayload(NOW);

    expect(Object.keys(payload).sort()).toEqual([
      "expires_at",
      "issued_at",
      "nonce",
      "purpose",
    ]);
    expect(payload.purpose).toBe(RECOVERY_COOKIE_PURPOSE);
    expect(payload.expires_at - payload.issued_at).toBe(
      RECOVERY_COOKIE_MAX_AGE_SECONDS,
    );
    expect(recoveryCookiePayloadContainsForbiddenData(payload)).toBe(false);
  });

  it("does not store access tokens, refresh tokens, user ids, or email", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, NOW);
    const encodedPayload = value.split(".")[0] ?? "";
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");

    expect(decoded.toLowerCase()).not.toContain("access_token");
    expect(decoded.toLowerCase()).not.toContain("refresh_token");
    expect(decoded.toLowerCase()).not.toContain("user_id");
    expect(decoded.toLowerCase()).not.toContain("email");
    expect(decoded.toLowerCase()).not.toContain("authorization");
  });
});

describe("verifyRecoveryCookieValue", () => {
  it("accepts a valid signed cookie", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, NOW);
    const result = verifyRecoveryCookieValue(value, TEST_SECRET, NOW + 10);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.purpose).toBe(RECOVERY_COOKIE_PURPOSE);
    }
  });

  it("rejects tampered signatures and clears eligibility", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, NOW);
    const tampered = `${value.slice(0, -1)}x`;
    const result = verifyRecoveryCookieValue(tampered, TEST_SECRET, NOW + 10);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("tampered");
    }
  });

  it("rejects tampered payload content", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, NOW);
    const [encodedPayload, signature] = value.split(".");
    const parsed = JSON.parse(
      Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    parsed.nonce = "different-nonce";
    const reencoded = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    const tampered = `${reencoded}.${signature ?? ""}`;
    const result = verifyRecoveryCookieValue(tampered, TEST_SECRET, NOW + 10);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("tampered");
    }
  });

  it("rejects expired cookies", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, NOW);
    const result = verifyRecoveryCookieValue(
      value,
      TEST_SECRET,
      NOW + RECOVERY_COOKIE_MAX_AGE_SECONDS + 1,
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("expired");
    }
  });

  it("rejects missing cookies", () => {
    const result = verifyRecoveryCookieValue(undefined, TEST_SECRET, NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("missing");
    }
  });
});

describe("recovery callback cookie response", () => {
  it("sets a valid sc_recovery cookie on redirect responses", () => {
    const response = NextResponse.redirect(
      "http://localhost:3000/reset-password",
    );
    setRecoveryCookieOnResponse(response);

    const cookie = response.cookies.get(RECOVERY_COOKIE_NAME);
    expect(cookie?.value).toBeTruthy();

    const validation = verifyRecoveryCookieValue(
      cookie?.value,
      TEST_SECRET,
      NOW + 10,
    );
    expect(validation.valid).toBe(true);

    const options = getRecoveryCookieOptions(false);
    expect(cookie?.httpOnly).toBe(options.httpOnly);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(RECOVERY_COOKIE_MAX_AGE_SECONDS);
  });
});

describe("recovery cookie production options", () => {
  it("marks cookies Secure in production", () => {
    const options = getRecoveryCookieOptions(true);
    expect(options.secure).toBe(true);
    expect(options.maxAge).toBe(900);
  });
});
