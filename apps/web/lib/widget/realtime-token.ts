import { createHmac } from "node:crypto";

import { env } from "@/lib/env";

const REALTIME_TOKEN_TTL_SECONDS = 15 * 60;

export type WidgetRealtimeTokenClaims = {
  role: "widget_realtime";
  purpose: "widget_realtime";
  topic: string;
  sub: string;
  exp: number;
  iat: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signPayload(payloadBase64: string): string {
  return createHmac("sha256", env.SUPABASE_JWT_SECRET)
    .update(payloadBase64)
    .digest("base64url");
}

export function createWidgetRealtimeToken(input: {
  topic: string;
  subject: string;
}): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((issuedAt + REALTIME_TOKEN_TTL_SECONDS) * 1000);

  const claims: WidgetRealtimeTokenClaims = {
    role: "widget_realtime",
    purpose: "widget_realtime",
    topic: input.topic,
    sub: input.subject,
    iat: issuedAt,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };

  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signature = signPayload(`${header}.${payload}`);

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt,
  };
}

export const WIDGET_REALTIME_TOKEN_TTL_MS = REALTIME_TOKEN_TTL_SECONDS * 1000;
