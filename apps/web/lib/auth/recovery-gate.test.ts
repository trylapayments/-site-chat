import { describe, expect, it } from "vitest";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  createRecoveryCookieValue,
  verifyExpiredRecoveryCookieBinding,
  verifyRecoveryCookieValue,
} from "@/lib/auth/recovery-cookie";
import {
  RECOVERY_EXPIRED_DESTINATION,
  resolveAppRecoveryGate,
  resolveResetPasswordGate,
} from "@/lib/auth/recovery-gate";

const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";
const SESSION_A = "bdd743e0-4844-49c5-b3b2-2cb4632a0b87";
const SESSION_B = "1c574637-81d9-478f-b8a2-08fe28a93bb5";
const NOW = 1_700_000_000;

describe("resolveResetPasswordGate", () => {
  it("redirects to forgot-password when cookie is missing", () => {
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(undefined, TEST_SECRET, {
        nowSeconds: NOW,
        sessionId: SESSION_A,
      }),
    });

    expect(decision).toEqual({
      action: "redirect",
      destination: AUTH_ROUTES.forgotPassword,
    });
  });

  it("allows reset-password when user and session-bound cookie are valid", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 10,
        sessionId: SESSION_A,
      }),
    });

    expect(decision).toEqual({ action: "allow" });
  });

  it("clears tampered cookies and redirects to forgot-password", () => {
    const cookie = `${createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW)}tampered`;
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 10,
        sessionId: SESSION_A,
      }),
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: AUTH_ROUTES.forgotPassword,
      signOutRecoverySession: false,
    });
  });

  it("clears session-mismatched cookies and redirects to forgot-password", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 10,
        sessionId: SESSION_B,
      }),
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: AUTH_ROUTES.forgotPassword,
      signOutRecoverySession: false,
    });
  });

  it("ends expired recovery sessions bound to the active session", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 901,
        sessionId: SESSION_A,
      }),
      expiredSessionBindingMatches: verifyExpiredRecoveryCookieBinding(
        cookie,
        TEST_SECRET,
        SESSION_A,
      ),
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: RECOVERY_EXPIRED_DESTINATION,
      signOutRecoverySession: true,
    });
  });
});

describe("resolveAppRecoveryGate", () => {
  it("redirects authenticated app requests to reset-password while recovery is active", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveAppRecoveryGate({
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 10,
        sessionId: SESSION_A,
      }),
    });

    expect(decision).toEqual({
      action: "redirect",
      destination: AUTH_ROUTES.resetPassword,
    });
  });

  it("continues when no recovery cookie is present", () => {
    const decision = resolveAppRecoveryGate({
      cookieValidation: verifyRecoveryCookieValue(undefined, TEST_SECRET, {
        nowSeconds: NOW,
        sessionId: SESSION_A,
      }),
    });

    expect(decision).toEqual({ action: "continue" });
  });

  it("ends expired recovery sessions instead of continuing into /app", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveAppRecoveryGate({
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 901,
        sessionId: SESSION_A,
      }),
      expiredSessionBindingMatches: verifyExpiredRecoveryCookieBinding(
        cookie,
        TEST_SECRET,
        SESSION_A,
      ),
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: RECOVERY_EXPIRED_DESTINATION,
      signOutRecoverySession: true,
    });
    expect(decision).not.toEqual({
      action: "continue",
    });
  });

  it("clears stale expired cookies and continues in /app when binding does not match", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveAppRecoveryGate({
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 901,
        sessionId: SESSION_B,
      }),
      expiredSessionBindingMatches: false,
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: AUTH_ROUTES.app,
      signOutRecoverySession: false,
    });
  });

  it("clears tampered cookies and continues in /app", () => {
    const cookie = `${createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW)}x`;
    const decision = resolveAppRecoveryGate({
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 10,
        sessionId: SESSION_A,
      }),
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: AUTH_ROUTES.app,
      signOutRecoverySession: false,
    });
  });

  it("clears session-mismatched cookies and continues in /app", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
    const decision = resolveAppRecoveryGate({
      cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
        nowSeconds: NOW + 10,
        sessionId: SESSION_B,
      }),
    });

    expect(decision).toEqual({
      action: "clear_via_handler",
      destination: AUTH_ROUTES.app,
      signOutRecoverySession: false,
    });
  });
});

describe("recovery completion and sign-out cleanup helpers", () => {
  it("treats cleared cookies as absent after password update flow", () => {
    const validation = verifyRecoveryCookieValue("", TEST_SECRET, {
      nowSeconds: NOW,
      sessionId: SESSION_A,
    });

    expect(validation.valid).toBe(false);
    expect(resolveAppRecoveryGate({ cookieValidation: validation })).toEqual({
      action: "continue",
    });
  });
});
