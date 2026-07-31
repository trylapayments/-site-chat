import { describe, expect, it } from "vitest";

import { AUTH_ERROR_CODES, getUserMessage } from "@/lib/auth/errors";
import {
  buildLoginUrl,
  resolveMiddlewareRedirect,
  sanitizeRecoveryClearDestination,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
import { buildRecoveryClearUrl } from "@/lib/auth/recovery-clear.server";
import { AUTH_ROUTES } from "@/lib/auth/constants";
describe("sanitizeRedirectPath", () => {
  it("allows safe app paths", () => {
    expect(sanitizeRedirectPath("/app")).toBe("/app");
    expect(sanitizeRedirectPath("/app/onboarding")).toBe("/app/onboarding");
    expect(sanitizeRedirectPath("/invite/abc")).toBe("/invite/abc");
  });

  it("rejects open redirects", () => {
    expect(sanitizeRedirectPath("//evil.com")).toBeNull();
    expect(sanitizeRedirectPath("https://evil.com")).toBeNull();
    expect(sanitizeRedirectPath("/\\evil.com")).toBeNull();
    expect(sanitizeRedirectPath("/login")).toBeNull();
    expect(sanitizeRedirectPath("%2f%2fevil.com")).toBeNull();
  });
});

describe("sanitizeRecoveryClearDestination", () => {
  it("allows recovery cleanup destinations for /app and /forgot-password", () => {
    expect(sanitizeRecoveryClearDestination("/app")).toBe("/app");
    expect(sanitizeRecoveryClearDestination("/app/settings")).toBe(
      "/app/settings",
    );
    expect(sanitizeRecoveryClearDestination("/forgot-password")).toBe(
      "/forgot-password",
    );
    expect(
      sanitizeRecoveryClearDestination("/auth-error?code=recovery_expired"),
    ).toBe("/auth-error?code=recovery_expired");
  });

  it("rejects open redirects for recovery cleanup", () => {
    expect(sanitizeRecoveryClearDestination("//evil.com")).toBeNull();
    expect(sanitizeRecoveryClearDestination("https://evil.com")).toBeNull();
    expect(sanitizeRecoveryClearDestination("/login")).toBeNull();
    expect(sanitizeRecoveryClearDestination("/reset-password")).toBeNull();
  });
});

describe("buildRecoveryClearUrl", () => {
  const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";

  it("builds handler URLs with signed cleanup tokens", () => {
    const appUrl = buildRecoveryClearUrl("/app", TEST_SECRET, {
      nowSeconds: 1_700_000_000,
    });
    expect(appUrl.startsWith(`${AUTH_ROUTES.authClearRecovery}?`)).toBe(true);
    expect(appUrl).toContain("destination=%2Fapp");
    expect(appUrl).toContain("token=");

    const forgotUrl = buildRecoveryClearUrl("/forgot-password", TEST_SECRET, {
      nowSeconds: 1_700_000_000,
    });
    expect(forgotUrl).toContain("destination=%2Fforgot-password");
    expect(forgotUrl).toContain("token=");
  });

  it("falls back to /app for unsafe destinations", () => {
    const url = buildRecoveryClearUrl("//evil.com", TEST_SECRET, {
      nowSeconds: 1_700_000_000,
    });
    expect(url).toContain("destination=%2Fapp");
    expect(url).toContain("token=");
  });
});

describe("resolveMiddlewareRedirect", () => {
  it("redirects unauthenticated app requests to login with next", () => {
    expect(resolveMiddlewareRedirect("/app", false)).toBe(
      buildLoginUrl("/app"),
    );
    expect(resolveMiddlewareRedirect("/app/settings", false)).toBe(
      buildLoginUrl("/app/settings"),
    );
  });

  it("redirects authenticated users away from login and signup only", () => {
    expect(resolveMiddlewareRedirect("/login", true)).toBe("/app");
    expect(resolveMiddlewareRedirect("/signup", true)).toBe("/app");
  });

  it("does not redirect authenticated users from recovery-related pages", () => {
    expect(resolveMiddlewareRedirect("/forgot-password", true)).toBeNull();
    expect(resolveMiddlewareRedirect("/reset-password", true)).toBeNull();
    expect(resolveMiddlewareRedirect("/check-email", true)).toBeNull();
    expect(resolveMiddlewareRedirect("/auth-error", true)).toBeNull();
  });
});

describe("getUserMessage", () => {
  it("uses generic sign-in and reset copy", () => {
    expect(getUserMessage(AUTH_ERROR_CODES.INVALID_CREDENTIALS)).toBe(
      "Invalid email or password.",
    );
    expect(getUserMessage(AUTH_ERROR_CODES.RESET_EMAIL_SENT)).toBe(
      "If an account exists, we sent a reset link.",
    );
    expect(getUserMessage(AUTH_ERROR_CODES.CONFIRMATION_SENT)).toBe(
      "If an account exists, check your email to continue.",
    );
  });
});
