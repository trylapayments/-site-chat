import { createHmac } from "node:crypto";

import { env } from "@/lib/env.server";

export function hashRateLimitKey(scope: string, identifier: string): string {
  return createHmac("sha256", env.RATE_LIMIT_SECRET)
    .update(`${scope}:${identifier}`)
    .digest("hex");
}

export function hashClientIp(ip: string | null): string {
  const normalized = ip?.trim() || "unknown";
  return hashRateLimitKey("ip", normalized);
}

export function hashSessionRateLimitKey(sessionToken: string): string {
  return hashRateLimitKey("session", sessionToken);
}

export const WIDGET_RATE_LIMITS = {
  bootstrap: { windowSeconds: 60, limit: 30 },
  session: { windowSeconds: 60, limit: 30 },
  messagesRead: { windowSeconds: 60, limit: 120 },
  messagesWrite: { windowSeconds: 60, limit: 60 },
  realtimeToken: { windowSeconds: 60, limit: 10 },
} as const;
