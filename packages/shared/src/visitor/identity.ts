import {
  RESERVED_VISITOR_ATTRIBUTE_KEYS,
  VISITOR_ATTRIBUTE_KEY_MAX_LENGTH,
  VISITOR_ATTRIBUTE_VALUE_MAX_LENGTH,
  VISITOR_ATTRIBUTES_MAX_COUNT,
  VISITOR_EMAIL_MAX_LENGTH,
  VISITOR_NAME_MAX_LENGTH,
  VISITOR_PHONE_DISPLAY_MAX_LENGTH,
  VISITOR_PHONE_MAX_LENGTH,
  VISITOR_PUBLIC_ID_PATTERN,
} from "./constants";

// Intentionally match C0 controls + DEL for sanitization.
// eslint-disable-next-line no-control-regex -- strip ASCII control characters from visitor input
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

export function isVisitorPublicId(value: string): boolean {
  return VISITOR_PUBLIC_ID_PATTERN.test(value);
}

/**
 * Normalize visitor name: trim, strip controls, bound length.
 * Returns null for empty/whitespace-only.
 */
export function normalizeVisitorName(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new VisitorIdentityError("INVALID_NAME", "Name must be a string");
  }
  const cleaned = stripControlChars(raw).trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) {
    return null;
  }
  if (cleaned.length > VISITOR_NAME_MAX_LENGTH) {
    throw new VisitorIdentityError("INVALID_NAME", "Name is too long");
  }
  return cleaned;
}

/**
 * Email normalization:
 * - trim
 * - strip controls
 * - lowercase the domain only (preserve local-part casing)
 * - validate basic format
 */
export function normalizeVisitorEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new VisitorIdentityError("INVALID_EMAIL", "Email must be a string");
  }

  const trimmed = stripControlChars(raw).trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > VISITOR_EMAIL_MAX_LENGTH) {
    throw new VisitorIdentityError("INVALID_EMAIL", "Email is too long");
  }

  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    throw new VisitorIdentityError("INVALID_EMAIL", "Invalid email format");
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();

  if (!local || !domain || domain.includes(" ") || !domain.includes(".")) {
    throw new VisitorIdentityError("INVALID_EMAIL", "Invalid email format");
  }

  // Reject obvious injection / header characters.
  if (/[<>"\s]/.test(local) || /[<>"\s]/.test(domain)) {
    throw new VisitorIdentityError("INVALID_EMAIL", "Invalid email format");
  }

  const normalized = `${local}@${domain}`;
  // Practical RFC-ish check without over-restricting internationalized domains
  // that have already been lowercased as ASCII/punycode by the host.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new VisitorIdentityError("INVALID_EMAIL", "Invalid email format");
  }

  return normalized;
}

export type NormalizedPhone = {
  /** Digits and leading + only when present; no invented country code. */
  normalized: string | null;
  /** Original trimmed display value (bounded). */
  display: string | null;
};

/**
 * Phone handling:
 * - retain display form
 * - normalize to leading + and digits when practical
 * - do not invent a country code
 */
export function normalizeVisitorPhone(raw: unknown): NormalizedPhone {
  if (raw === null || raw === undefined) {
    return { normalized: null, display: null };
  }
  if (typeof raw !== "string") {
    throw new VisitorIdentityError("INVALID_PHONE", "Phone must be a string");
  }

  const display = stripControlChars(raw).trim().replace(/\s+/g, " ");
  if (display.length === 0) {
    return { normalized: null, display: null };
  }
  if (display.length > VISITOR_PHONE_DISPLAY_MAX_LENGTH) {
    throw new VisitorIdentityError("INVALID_PHONE", "Phone is too long");
  }

  const hasPlus = display.trimStart().startsWith("+");
  const digits = display.replace(/\D/g, "");
  if (digits.length === 0) {
    throw new VisitorIdentityError("INVALID_PHONE", "Invalid phone format");
  }
  if (digits.length > VISITOR_PHONE_MAX_LENGTH) {
    throw new VisitorIdentityError("INVALID_PHONE", "Phone is too long");
  }

  const normalized = hasPlus ? `+${digits}` : digits;
  return { normalized, display };
}

const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

function isReservedAttributeKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (RESERVED_VISITOR_ATTRIBUTE_KEYS as readonly string[]).some(
    (reserved) => reserved.toLowerCase() === lower,
  );
}

export type PrimitiveAttributeValue = string | number | boolean | null;

/**
 * Validate custom attributes map.
 * - bounded key/value/count
 * - primitive JSON values only
 * - reject prototype-pollution / reserved keys
 */
export function normalizeVisitorAttributes(raw: unknown): Record<string, PrimitiveAttributeValue> {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Attributes must be an object");
  }

  // Guard against prototype pollution via Object.create(null) copy.
  const source = raw as Record<string, unknown>;
  const keys = Reflect.ownKeys(source).filter((key): key is string => typeof key === "string");

  if (keys.length > VISITOR_ATTRIBUTES_MAX_COUNT) {
    throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Too many attributes");
  }

  const result = Object.create(null) as Record<string, PrimitiveAttributeValue>;

  for (const key of keys) {
    if (key.length === 0 || key.length > VISITOR_ATTRIBUTE_KEY_MAX_LENGTH) {
      throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Attribute key length out of bounds");
    }
    if (
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype" ||
      isReservedAttributeKey(key)
    ) {
      throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Reserved attribute key");
    }
    if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
      throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Invalid attribute key");
    }

    const value = source[key];
    if (value === null) {
      result[key] = null;
      continue;
    }
    if (typeof value === "boolean") {
      result[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Attribute number must be finite");
      }
      result[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const cleaned = stripControlChars(value);
      if (cleaned.length > VISITOR_ATTRIBUTE_VALUE_MAX_LENGTH) {
        throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Attribute value too long");
      }
      result[key] = cleaned;
      continue;
    }

    throw new VisitorIdentityError(
      "INVALID_ATTRIBUTES",
      "Attribute values must be string, number, boolean, or null",
    );
  }

  return result;
}

/** Shallow merge attributes; later values overwrite; null deletes a key. */
export function mergeVisitorAttributes(
  existing: Record<string, PrimitiveAttributeValue>,
  patch: Record<string, PrimitiveAttributeValue>,
): Record<string, PrimitiveAttributeValue> {
  const next = Object.create(null) as Record<string, PrimitiveAttributeValue>;
  for (const [key, value] of Object.entries(existing)) {
    next[key] = value;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      // Null means delete the attribute key from the map.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- intentional attribute removal
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  if (Object.keys(next).length > VISITOR_ATTRIBUTES_MAX_COUNT) {
    throw new VisitorIdentityError("INVALID_ATTRIBUTES", "Too many attributes");
  }
  return next;
}

export type VisitorIdentityErrorCode =
  "INVALID_NAME" | "INVALID_EMAIL" | "INVALID_PHONE" | "INVALID_ATTRIBUTES" | "INVALID_PUBLIC_ID";

export class VisitorIdentityError extends Error {
  readonly code: VisitorIdentityErrorCode;

  constructor(code: VisitorIdentityErrorCode, message: string) {
    super(message);
    this.name = "VisitorIdentityError";
    this.code = code;
  }
}
