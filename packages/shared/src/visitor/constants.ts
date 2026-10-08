/** Stable opaque visitor public id: vis_ + 32 hex chars. Display/correlation only — NOT authorization. */
export const VISITOR_PUBLIC_ID_PATTERN = /^vis_[a-f0-9]{32}$/;

/**
 * Opaque continuity token: the cross-session/cross-browser authorization binder
 * for a visitor contact (see `contacts.continuity_token_hash`). Plaintext is
 * minted server-side and returned once; the client persists it (e.g. localStorage)
 * and replays it to resume the same contact on a new session. Never derived from
 * or equal to `visitorPublicId`.
 */
export const CONTINUITY_TOKEN_MIN_LENGTH = 20;
export const CONTINUITY_TOKEN_MAX_LENGTH = 128;
export const CONTINUITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export const VISITOR_NAME_MAX_LENGTH = 120;
export const VISITOR_EMAIL_MAX_LENGTH = 254;
export const VISITOR_PHONE_MAX_LENGTH = 32;
export const VISITOR_PHONE_DISPLAY_MAX_LENGTH = 64;

export const VISITOR_ATTRIBUTE_KEY_MAX_LENGTH = 64;
export const VISITOR_ATTRIBUTE_VALUE_MAX_LENGTH = 500;
export const VISITOR_ATTRIBUTES_MAX_COUNT = 50;

export const VISITOR_URL_MAX_LENGTH = 2048;
export const VISITOR_TITLE_MAX_LENGTH = 500;
export const VISITOR_REFERRER_MAX_LENGTH = 2048;
export const VISITOR_UTM_MAX_LENGTH = 200;
export const VISITOR_TIMEZONE_MAX_LENGTH = 64;
export const VISITOR_LANGUAGE_MAX_LENGTH = 35;
export const VISITOR_USER_AGENT_MAX_LENGTH = 512;
export const VISITOR_TAB_ID_MAX_LENGTH = 64;

/**
 * Query params kept by `sanitizePageUrl`/`sanitizeReferrer`. Allowlist (not a
 * blacklist) — every other query param is stripped. Must match SQL
 * `app_private.sanitize_page_url`.
 */
export const ALLOWED_UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type AllowedUtmParam = (typeof ALLOWED_UTM_PARAMS)[number];

/** Recent page views returned to operators (bounded). */
export const VISITOR_RECENT_PAGE_VIEWS_LIMIT = 20;

/** Server-side page-view dedupe window (seconds). */
export const VISITOR_PAGE_VIEW_DEDUPE_SECONDS = 30;

/** Client throttle for SPA page-view posts (ms). */
export const VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS = 1_000;

export const RESERVED_VISITOR_ATTRIBUTE_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "workspace_id",
  "workspaceId",
  "visitor_id",
  "visitorId",
  "contact_id",
  "contactId",
  "public_id",
  "publicId",
  "session_id",
  "sessionId",
  "id",
] as const;

export const DEVICE_TYPES = ["desktop", "mobile", "tablet", "bot", "unknown"] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];
