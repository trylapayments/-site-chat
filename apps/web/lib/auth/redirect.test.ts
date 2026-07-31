import { describe, expect, it } from "vitest";

import { AUTH_ERROR_CODES, getUserMessage } from "@/lib/auth/errors";
import {
  buildLoginUrl,
  resolveMiddlewareRedirect,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
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
