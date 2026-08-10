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
 * Verify a browser-supplied Origin header against the embed token's bound
 * `parentOrigin`. Widget requests are same-origin-embedded, so a browser that
 * sends an `Origin` header MUST match the embed context — a mismatch means
 * the embed token (issued for a different parent origin) is being replayed
 * from elsewhere and must be denied.
 *
 * Requests with NO `Origin` header (non-browser/server-to-server clients,
 * or browsers that omit it for same-origin navigations) are allowed through
 * here — they still must carry a valid embed token + session, which are
 * checked separately. This mirrors the stricter policy note in the task:
 * "Origin present + mismatch -> deny; Origin absent -> allow" (defense in
 * depth on top of, not instead of, embed-token verification).
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

  return normalizedOrigin === normalizedParent;
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}
