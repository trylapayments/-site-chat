import type { Route } from "next";

import {
  MAX_REDIRECT_PATH_LENGTH,
  SAFE_REDIRECT_FALLBACK,
  SAFE_REDIRECT_PREFIXES,
} from "@/lib/auth/constants";

/** Cast validated internal paths for Next.js typed routes. */
export function toAppRoute(path: string): Route {
  return path as Route;
}

/**
 * Returns a safe same-origin relative path or null when the input is invalid.
 * Prevents open redirects.
 */
export function sanitizeRedirectPath(
  path: string | null | undefined,
): string | null {
  if (!path) {
    return null;
  }

  const trimmed = path.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_REDIRECT_PATH_LENGTH ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    trimmed.includes("%2f%2f") ||
    trimmed.includes("%2F%2F")
  ) {
    return null;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return null;
  }

  const allowed = SAFE_REDIRECT_PREFIXES.some(
    (prefix) => trimmed === prefix.slice(0, -1) || trimmed.startsWith(prefix),
  );

  if (!allowed) {
    return null;
  }

  return trimmed;
}

export function resolveSafeRedirectPath(
  path: string | null | undefined,
): string {
  return sanitizeRedirectPath(path) ?? SAFE_REDIRECT_FALLBACK;
}

/**
 * Allowed destinations for /auth/clear-recovery after invalid sc_recovery cleanup.
 */
export function sanitizeRecoveryClearDestination(
  path: string | null | undefined,
): string | null {
  if (!path) {
    return null;
  }

  const trimmed = path.trim();

  if (trimmed === "/forgot-password") {
    return trimmed;
  }

  if (trimmed === "/auth-error?code=recovery_expired") {
    return trimmed;
  }

  return sanitizeRedirectPath(trimmed);
}

/**
 * Allowed destinations for /invite/clear after terminal sc_invite cleanup.
 */
export function sanitizeInviteClearDestination(
  path: string | null | undefined,
): string | null {
  if (!path) {
    return null;
  }

  const trimmed = path.trim();

  if (trimmed === "/auth-error?code=invite_invalid") {
    return trimmed;
  }

  return sanitizeRedirectPath(trimmed);
}

/**
 * Builds a login URL preserving an optional post-auth destination.
 */
export function buildLoginUrl(nextPath?: string | null): string {
  const safeNext = sanitizeRedirectPath(nextPath);
  if (!safeNext) {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(safeNext)}`;
}

/**
 * Coarse middleware redirect decisions.
 * Authorization remains in server layouts and RLS.
 */
export function resolveMiddlewareRedirect(
  pathname: string,
  isAuthenticated: boolean,
): string | null {
  if (!isAuthenticated && pathname.startsWith("/app")) {
    return buildLoginUrl(pathname);
  }

  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    return "/app";
  }

  return null;
}
