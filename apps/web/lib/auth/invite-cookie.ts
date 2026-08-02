import crypto from "node:crypto";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

export const INVITE_COOKIE_NAME = "sc_invite";
export const INVITE_COOKIE_MAX_AGE_SECONDS = 3600;
export const INVITE_COOKIE_PURPOSE = "workspace_invitation" as const;

const INVITE_COOKIE_PATH = "/";

export type InviteCookiePayload = {
  purpose: typeof INVITE_COOKIE_PURPOSE;
  issued_at: number;
  expires_at: number;
  invitation_token: string;
};

export type InviteCookiePayloadKeys = keyof InviteCookiePayload;

const ALLOWED_PAYLOAD_KEYS = [
  "purpose",
  "issued_at",
  "expires_at",
  "invitation_token",
] as const satisfies readonly InviteCookiePayloadKeys[];

const FORBIDDEN_PAYLOAD_KEYS = [
  "access_token",
  "refresh_token",
  "user_id",
  "email",
  "authorization",
  "session_id",
  "sub",
  "token",
] as const;

export type InviteCookieValidationResult =
  | { valid: true; payload: InviteCookiePayload }
  | {
      valid: false;
      reason: "missing" | "malformed" | "tampered" | "expired";
    };

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createInviteCookiePayload(
  invitationToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): InviteCookiePayload {
  return {
    purpose: INVITE_COOKIE_PURPOSE,
    issued_at: nowSeconds,
    expires_at: nowSeconds + INVITE_COOKIE_MAX_AGE_SECONDS,
    invitation_token: invitationToken,
  };
}

export function serializeInviteCookiePayload(
  payload: InviteCookiePayload,
): string {
  assertInviteCookiePayloadShape(payload);
  return base64UrlEncode(JSON.stringify(payload));
}

export function createInviteCookieValue(
  secret: string,
  invitationToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const payload = createInviteCookiePayload(invitationToken, nowSeconds);
  const encodedPayload = serializeInviteCookiePayload(payload);
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyInviteCookieValue(
  value: string | undefined,
  secret: string,
  options: {
    nowSeconds?: number;
  } = {},
): InviteCookieValidationResult {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!value) {
    return { valid: false, reason: "missing" };
  }

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return { valid: false, reason: "malformed" };
  }

  const encodedPayload = value.slice(0, separatorIndex);
  const providedSignature = value.slice(separatorIndex + 1);

  if (!encodedPayload || !providedSignature) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeEqualStrings(providedSignature, expectedSignature)) {
    return { valid: false, reason: "tampered" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (!isInviteCookiePayload(parsed)) {
    return { valid: false, reason: "malformed" };
  }

  if (parsed.expires_at <= nowSeconds) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload: parsed };
}

export function getInviteCookieOptions(
  isProduction: boolean,
): Pick<
  ResponseCookie,
  "httpOnly" | "secure" | "sameSite" | "path" | "maxAge"
> {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: INVITE_COOKIE_PATH,
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
  };
}

export function getInviteCookieClearOptions(): Pick<
  ResponseCookie,
  "httpOnly" | "secure" | "sameSite" | "path" | "maxAge"
> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: INVITE_COOKIE_PATH,
    maxAge: 0,
  };
}

export function assertInviteCookiePayloadShape(
  payload: InviteCookiePayload,
): void {
  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!ALLOWED_PAYLOAD_KEYS.includes(key as InviteCookiePayloadKeys)) {
      throw new Error(`Unexpected invite cookie payload key: ${key}`);
    }
  }

  for (const forbiddenKey of FORBIDDEN_PAYLOAD_KEYS) {
    if (forbiddenKey in payload) {
      throw new Error(`Forbidden invite cookie payload key: ${forbiddenKey}`);
    }
  }
}

function isInviteCookiePayload(value: unknown): value is InviteCookiePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !ALLOWED_PAYLOAD_KEYS.includes(key as InviteCookiePayloadKeys),
    )
  ) {
    return false;
  }

  return (
    record.purpose === INVITE_COOKIE_PURPOSE &&
    typeof record.issued_at === "number" &&
    Number.isInteger(record.issued_at) &&
    typeof record.expires_at === "number" &&
    Number.isInteger(record.expires_at) &&
    typeof record.invitation_token === "string" &&
    record.invitation_token.length > 0
  );
}
