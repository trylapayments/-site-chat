import crypto from "node:crypto";

export const RECOVERY_CLEANUP_TOKEN_PURPOSE = "recovery_cleanup" as const;
export const RECOVERY_CLEANUP_TOKEN_MAX_AGE_SECONDS = 60;

export type RecoveryCleanupTokenPayload = {
  purpose: typeof RECOVERY_CLEANUP_TOKEN_PURPOSE;
  destination: string;
  sign_out: boolean;
  issued_at: number;
  expires_at: number;
  nonce: string;
};

export type RecoveryCleanupTokenVerificationResult =
  | {
      valid: true;
      destination: string;
      signOut: boolean;
    }
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

function isRecoveryCleanupTokenPayload(
  value: unknown,
): value is RecoveryCleanupTokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    record.purpose === RECOVERY_CLEANUP_TOKEN_PURPOSE &&
    typeof record.destination === "string" &&
    record.destination.length > 0 &&
    typeof record.sign_out === "boolean" &&
    typeof record.issued_at === "number" &&
    Number.isInteger(record.issued_at) &&
    typeof record.expires_at === "number" &&
    Number.isInteger(record.expires_at) &&
    typeof record.nonce === "string" &&
    record.nonce.length > 0
  );
}

export function createRecoveryCleanupToken(
  secret: string,
  destination: string,
  options: {
    signOut?: boolean;
    nowSeconds?: number;
  } = {},
): string {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: RecoveryCleanupTokenPayload = {
    purpose: RECOVERY_CLEANUP_TOKEN_PURPOSE,
    destination,
    sign_out: options.signOut ?? false,
    issued_at: nowSeconds,
    expires_at: nowSeconds + RECOVERY_CLEANUP_TOKEN_MAX_AGE_SECONDS,
    nonce: createNonce(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyRecoveryCleanupToken(
  token: string | null | undefined,
  secret: string,
  options: {
    nowSeconds?: number;
  } = {},
): RecoveryCleanupTokenVerificationResult {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!token) {
    return { valid: false, reason: "missing" };
  }

  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return { valid: false, reason: "malformed" };
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);

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

  if (!isRecoveryCleanupTokenPayload(parsed)) {
    return { valid: false, reason: "malformed" };
  }

  if (parsed.expires_at <= nowSeconds) {
    return { valid: false, reason: "expired" };
  }

  return {
    valid: true,
    destination: parsed.destination,
    signOut: parsed.sign_out,
  };
}
