import { describe, expect, it } from "vitest";

import { AUTH_ERROR_CODES, getUserMessage } from "@/lib/auth/errors";
import {
  buildLoginUrl,
  buildRecoveryClearUrl,
  resolveMiddlewareRedirect,
  sanitizeRecoveryClearDestination,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
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
  });

  it("rejects open redirects for recovery cleanup", () => {
    expect(sanitizeRecoveryClearDestination("//evil.com")).toBeNull();
    expect(sanitizeRecoveryClearDestination("https://evil.com")).toBeNull();
    expect(sanitizeRecoveryClearDestination("/login")).toBeNull();
    expect(sanitizeRecoveryClearDestination("/reset-password")).toBeNull();
  });
});

describe("buildRecoveryClearUrl", () => {
  it("builds handler URLs for safe cleanup destinations", () => {
    expect(buildRecoveryClearUrl("/app")).toBe(
      `${AUTH_ROUTES.authClearRecovery}?destination=%2Fapp`,
    );
    expect(buildRecoveryClearUrl("/forgot-password")).toBe(
      `${AUTH_ROUTES.authClearRecovery}?destination=%2Fforgot-password`,
    );
  });

  it("falls back to /app for unsafe destinations", () => {
    expect(buildRecoveryClearUrl("//evil.com")).toBe(
      `${AUTH_ROUTES.authClearRecovery}?destination=%2Fapp`,
    );
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
