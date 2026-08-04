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

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}
