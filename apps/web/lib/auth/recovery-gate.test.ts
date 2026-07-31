import { describe, expect, it } from "vitest";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  createRecoveryCookieValue,
  verifyRecoveryCookieValue,
} from "@/lib/auth/recovery-cookie";
import {
  resolveAppRecoveryGate,
  resolveResetPasswordGate,
} from "@/lib/auth/recovery-gate";

const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";
const NOW = 1_700_000_000;

describe("resolveResetPasswordGate", () => {
  it("redirects to forgot-password when cookie is missing", () => {
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(undefined, TEST_SECRET, NOW),
    });

    expect(decision).toEqual({
      action: "redirect",
      destination: AUTH_ROUTES.forgotPassword,
    });
  });

  it("allows reset-password when user and cookie are valid", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, NOW);
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(
        cookie,
        TEST_SECRET,
        NOW + 10,
      ),
    });

    expect(decision).toEqual({ action: "allow" });
  });

  it("clears tampered cookies and redirects to forgot-password", () => {
    const cookie = `${createRecoveryCookieValue(TEST_SECRET, NOW)}tampered`;
    const decision = resolveResetPasswordGate({
      hasAuthenticatedUser: true,
      cookieValidation: verifyRecoveryCookieValue(
        cookie,
        TEST_SECRET,
        NOW + 10,
      ),
    });

    expect(decision).toEqual({
      action: "clear_and_redirect",
      destination: AUTH_ROUTES.forgotPassword,
    });
  });

  it("rejects expired cookies", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, NOW);
    const validation = verifyRecoveryCookieValue(
      cookie,
      TEST_SECRET,
      NOW + 901,
    );

    expect(validation.valid).toBe(false);
    expect(
      resolveResetPasswordGate({
        hasAuthenticatedUser: true,
        cookieValidation: validation,
      }),
    ).toEqual({
      action: "clear_and_redirect",
      destination: AUTH_ROUTES.forgotPassword,
    });
  });
});

describe("resolveAppRecoveryGate", () => {
  it("redirects authenticated app requests to reset-password while recovery is active", () => {
    const cookie = createRecoveryCookieValue(TEST_SECRET, NOW);
    const decision = resolveAppRecoveryGate(
      verifyRecoveryCookieValue(cookie, TEST_SECRET, NOW + 10),
    );

    expect(decision).toEqual({
      action: "redirect",
      destination: AUTH_ROUTES.resetPassword,
    });
  });

  it("continues when no valid recovery cookie is present", () => {
    const decision = resolveAppRecoveryGate(
      verifyRecoveryCookieValue(undefined, TEST_SECRET, NOW),
    );

    expect(decision).toEqual({ action: "continue" });
  });
});

describe("recovery completion and sign-out cleanup helpers", () => {
  it("treats cleared cookies as absent after password update flow", () => {
    const clearedValue = "";
    const validation = verifyRecoveryCookieValue(
      clearedValue,
      TEST_SECRET,
      NOW,
    );

    expect(validation.valid).toBe(false);
    expect(resolveAppRecoveryGate(validation)).toEqual({ action: "continue" });
  });
});
