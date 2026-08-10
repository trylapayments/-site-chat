import { normalizeParentOrigin } from "@/lib/widget/embed-token";

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isDevelopmentEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

export function extractOriginHost(origin: string | null): string | null {
  if (!origin) {
    return null;
  }

  const normalized = normalizeParentOrigin(origin);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDevLocalOrigin(origin: string | null): boolean {
  if (!isDevelopmentEnvironment()) {
    return false;
  }

  const host = extractOriginHost(origin);
  return host !== null && DEV_HOSTS.has(host);
}

export function getRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  if (!isDevelopmentEnvironment()) {
    return null;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    const refererOrigin = new URL(referer).origin;
    return isDevLocalOrigin(refererOrigin) ? refererOrigin : null;
  } catch {
    return null;
  }
}

/**
 * Verify a browser-supplied Origin header against allowed embed origins.
 *
 * Allowed when Origin is present:
 * 1. `parentOrigin` from the embed token (host page / CORS callers)
 * 2. The Site Chat widget API origin (`request.url`) — the embed iframe is
 *    hosted on the app origin and issues same-origin fetches from there.
 *    Comparing only to parentOrigin incorrectly blocks all iframe API calls.
 *
 * Denied when Origin is present and matches neither (token replay from an
 * unrelated site).
 *
 * Requests with NO `Origin` header (non-browser / some same-site cases) are
 * allowed here; they still require a valid embed token + session.
 */
export function requestOriginMatchesEmbed(
  request: Request,
  parentOrigin: string,
): boolean {
  const origin = getRequestOrigin(request);
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeParentOrigin(origin);
  const normalizedParent = normalizeParentOrigin(parentOrigin);
  if (!normalizedOrigin || !normalizedParent) {
    return false;
  }

  if (normalizedOrigin === normalizedParent) {
    return true;
  }

  try {
    const apiOrigin = normalizeParentOrigin(new URL(request.url).origin);
    return apiOrigin !== null && normalizedOrigin === apiOrigin;
  } catch {
    return false;
  }
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}
