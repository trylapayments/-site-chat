import crypto from "node:crypto";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

export const RECOVERY_COOKIE_NAME = "sc_recovery";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 900;
export const RECOVERY_COOKIE_PURPOSE = "password_recovery" as const;

const RECOVERY_COOKIE_PATH = "/";

export type RecoveryCookiePayload = {
  purpose: typeof RECOVERY_COOKIE_PURPOSE;
  issued_at: number;
  expires_at: number;
  nonce: string;
};

export type RecoveryCookiePayloadKeys = keyof RecoveryCookiePayload;

const ALLOWED_PAYLOAD_KEYS = [
  "purpose",
  "issued_at",
  "expires_at",
  "nonce",
] as const satisfies readonly RecoveryCookiePayloadKeys[];

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

export type RecoveryCookieValidationResult =
  | { valid: true; payload: RecoveryCookiePayload }
  | {
      valid: false;
      reason:
        "missing" | "malformed" | "tampered" | "expired" | "invalid_purpose";
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

function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createRecoveryCookiePayload(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RecoveryCookiePayload {
  return {
    purpose: RECOVERY_COOKIE_PURPOSE,
    issued_at: nowSeconds,
    expires_at: nowSeconds + RECOVERY_COOKIE_MAX_AGE_SECONDS,
    nonce: createNonce(),
  };
}

export function serializeRecoveryCookiePayload(
  payload: RecoveryCookiePayload,
): string {
  assertRecoveryCookiePayloadShape(payload);
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return encodedPayload;
}

export function createRecoveryCookieValue(
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const payload = createRecoveryCookiePayload(nowSeconds);
  const encodedPayload = serializeRecoveryCookiePayload(payload);
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyRecoveryCookieValue(
  value: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RecoveryCookieValidationResult {
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

  if (!isRecoveryCookiePayload(parsed)) {
    return { valid: false, reason: "malformed" };
  }

  if (parsed.expires_at <= nowSeconds) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload: parsed };
}

export function getRecoveryCookieOptions(
  isProduction: boolean,
): Pick<
  ResponseCookie,
  "httpOnly" | "secure" | "sameSite" | "path" | "maxAge"
> {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: RECOVERY_COOKIE_PATH,
    maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
  };
}

export function getRecoveryCookieClearOptions(): Pick<
  ResponseCookie,
  "httpOnly" | "secure" | "sameSite" | "path" | "maxAge"
> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: RECOVERY_COOKIE_PATH,
    maxAge: 0,
  };
}

export function assertRecoveryCookiePayloadShape(
  payload: RecoveryCookiePayload,
): void {
  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!ALLOWED_PAYLOAD_KEYS.includes(key as RecoveryCookiePayloadKeys)) {
      throw new Error(`Unexpected recovery cookie payload key: ${key}`);
    }
  }

  for (const forbiddenKey of FORBIDDEN_PAYLOAD_KEYS) {
    if (forbiddenKey in payload) {
      throw new Error(`Forbidden recovery cookie payload key: ${forbiddenKey}`);
    }
  }
}

export function recoveryCookiePayloadContainsForbiddenData(
  payload: RecoveryCookiePayload,
): boolean {
  const serialized = JSON.stringify(payload).toLowerCase();
  return FORBIDDEN_PAYLOAD_KEYS.some((key) => serialized.includes(`"${key}"`));
}

function isRecoveryCookiePayload(
  value: unknown,
): value is RecoveryCookiePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !ALLOWED_PAYLOAD_KEYS.includes(key as RecoveryCookiePayloadKeys),
    )
  ) {
    return false;
  }

  return (
    record.purpose === RECOVERY_COOKIE_PURPOSE &&
    typeof record.issued_at === "number" &&
    Number.isInteger(record.issued_at) &&
    typeof record.expires_at === "number" &&
    Number.isInteger(record.expires_at) &&
    typeof record.nonce === "string" &&
    record.nonce.length > 0
  );
}
