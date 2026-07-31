import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  createRecoveryCookiePayload,
  createRecoveryCookieValue,
  deriveSessionBinding,
  getRecoveryCookieOptions,
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
  RECOVERY_COOKIE_PURPOSE,
  recoveryCookiePayloadContainsForbiddenData,
  verifyRecoveryCookieValue,
} from "@/lib/auth/recovery-cookie";
import { setRecoveryCookieOnResponse } from "@/lib/auth/recovery-cookie.server";

const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";
const SESSION_A = "bdd743e0-4844-49c5-b3b2-2cb4632a0b87";
const SESSION_B = "1c574637-81d9-478f-b8a2-08fe28a93bb5";
const NOW = 1_700_000_000;

vi.mock("@/lib/env", () => ({
  env: {
    AUTH_COOKIE_SECRET: "test-auth-cookie-secret-min-32-characters",
    NODE_ENV: "test",
  },
}));

describe("recovery cookie payload", () => {
  it("contains only purpose, issued_at, expires_at, nonce, and session_binding", () => {
    const payload = createRecoveryCookiePayload(TEST_SECRET, SESSION_A, NOW);

    expect(Object.keys(payload).sort()).toEqual([
      "expires_at",
      "issued_at",
      "nonce",
      "purpose",
      "session_binding",
    ]);
    expect(payload.purpose).toBe(RECOVERY_COOKIE_PURPOSE);
    expect(payload.session_binding).toBe(
      deriveSessionBinding(TEST_SECRET, SESSION_A),
    );
    expect(recoveryCookiePayloadContainsForbiddenData(payload, SESSION_A)).toBe(
      false,
    );
  });

  it("does not store raw session_id, user ids, email, or auth tokens", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const encodedPayload = value.split(".")[0] ?? "";
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");

    expect(decoded.toLowerCase()).not.toContain("access_token");
    expect(decoded.toLowerCase()).not.toContain("refresh_token");
    expect(decoded.toLowerCase()).not.toContain("user_id");
    expect(decoded.toLowerCase()).not.toContain("email");
    expect(decoded.toLowerCase()).not.toContain("authorization");
    expect(decoded.toLowerCase()).not.toContain("session_id");
    expect(decoded).not.toContain(SESSION_A);
  });
});

describe("verifyRecoveryCookieValue", () => {
  it("accepts a session-bound cookie for the originating session", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const result = verifyRecoveryCookieValue(value, TEST_SECRET, {
      nowSeconds: NOW + 10,
      sessionId: SESSION_A,
    });

    expect(result.valid).toBe(true);
  });

  it("rejects the same cookie when validated against another session_id", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const result = verifyRecoveryCookieValue(value, TEST_SECRET, {
      nowSeconds: NOW + 10,
      sessionId: SESSION_B,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("session_mismatch");
    }
  });

  it("rejects tampered signatures", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const tampered = `${value.slice(0, -1)}x`;
    const result = verifyRecoveryCookieValue(tampered, TEST_SECRET, {
      nowSeconds: NOW + 10,
      sessionId: SESSION_A,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("tampered");
    }
  });

  it("rejects expired cookies", () => {
    const value = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const result = verifyRecoveryCookieValue(value, TEST_SECRET, {
      nowSeconds: NOW + RECOVERY_COOKIE_MAX_AGE_SECONDS + 1,
      sessionId: SESSION_A,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("expired");
    }
  });

  it("rejects missing cookies", () => {
    const result = verifyRecoveryCookieValue(undefined, TEST_SECRET, {
      nowSeconds: NOW,
      sessionId: SESSION_A,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("missing");
    }
  });
});

describe("recovery callback cookie response", () => {
  it("sets a session-bound sc_recovery cookie on redirect responses", () => {
    const response = NextResponse.redirect(
      "http://localhost:3000/reset-password",
    );
    setRecoveryCookieOnResponse(response, SESSION_A);

    const cookie = response.cookies.get(RECOVERY_COOKIE_NAME);
    expect(cookie?.value).toBeTruthy();

    const validation = verifyRecoveryCookieValue(cookie?.value, TEST_SECRET, {
      nowSeconds: NOW + 10,
      sessionId: SESSION_A,
    });
    expect(validation.valid).toBe(true);

    const options = getRecoveryCookieOptions(false);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(RECOVERY_COOKIE_MAX_AGE_SECONDS);
    expect(options.httpOnly).toBe(true);
  });
});

describe("recovery cookie production options", () => {
  it("marks cookies Secure in production", () => {
    const options = getRecoveryCookieOptions(true);
    expect(options.secure).toBe(true);
    expect(options.maxAge).toBe(900);
  });
});
