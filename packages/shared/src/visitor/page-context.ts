import {
  ALLOWED_UTM_PARAMS,
  VISITOR_REFERRER_MAX_LENGTH,
  VISITOR_TITLE_MAX_LENGTH,
  VISITOR_URL_MAX_LENGTH,
  VISITOR_UTM_MAX_LENGTH,
} from "./constants";
import { stripControlChars } from "./identity";

export type UtmParams = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

export type PageContext = {
  url: string | null;
  title: string | null;
  referrer: string | null;
  landingUrl: string | null;
} & UtmParams;

const SCRIPT_SCHEME_PATTERN = /^(javascript|data|vbscript):/i;

function clampText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function cleanUtmValue(raw: string): string | null {
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length === 0) {
    return null;
  }
  return clampText(cleaned, VISITOR_UTM_MAX_LENGTH);
}

/**
 * Sanitize an untrusted URL from the host page for privacy-safe storage.
 *
 * Policy (must match SQL `app_private.sanitize_page_url`):
 * - Accept only http/https; reject javascript:/data:/vbscript: and any other scheme.
 * - Strip credentials (userinfo).
 * - Strip the fragment/hash entirely.
 * - Keep ONLY allowlisted UTM query params (utm_source, utm_medium, utm_campaign,
 *   utm_content, utm_term). Every other query param is dropped — this is an
 *   allowlist, not a blacklist, so OAuth `code`/`state`, password-reset/magic-link
 *   tokens, and any other secret-bearing query params never persist.
 * - Return origin + pathname + optional allowlisted query only.
 * - Bound length to VISITOR_URL_MAX_LENGTH.
 */
export function sanitizePageUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }

  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length === 0) {
    return null;
  }

  if (SCRIPT_SCHEME_PATTERN.test(cleaned)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (!parsed.host) {
    return null;
  }

  const utmParts: string[] = [];
  for (const key of ALLOWED_UTM_PARAMS) {
    const rawValue = parsed.searchParams.get(key);
    if (rawValue === null) {
      continue;
    }
    const value = cleanUtmValue(rawValue);
    if (value === null) {
      continue;
    }
    utmParts.push(`${key}=${encodeURIComponent(value)}`);
  }

  const path = parsed.pathname.length > 0 ? parsed.pathname : "/";
  const query = utmParts.length > 0 ? `?${utmParts.join("&")}` : "";
  const result = `${parsed.origin}${path}${query}`;

  return clampText(result, VISITOR_URL_MAX_LENGTH);
}

export function sanitizePageTitle(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = stripControlChars(raw).trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) {
    return null;
  }
  return clampText(cleaned, VISITOR_TITLE_MAX_LENGTH);
}

/**
 * Sanitize a referrer value. Absolute http(s) referrers go through the same
 * privacy policy as `sanitizePageUrl` (secrets stripped, UTM allowlist only).
 * Referrers may also be opaque/non-URL strings on some browsers (e.g. the
 * empty string, or a privacy-trimmed origin-only value) — those are kept as
 * bounded text after rejecting script schemes, since they are not parseable
 * URLs to redact.
 */
export function sanitizeReferrer(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length === 0) {
    return null;
  }

  if (SCRIPT_SCHEME_PATTERN.test(cleaned)) {
    return null;
  }

  const asUrl = sanitizePageUrl(cleaned);
  if (asUrl) {
    return asUrl;
  }

  return clampText(cleaned, VISITOR_REFERRER_MAX_LENGTH);
}

/**
 * Extract UTM params from a URL. Intended to be called with an already
 * `sanitizePageUrl`-sanitized URL, whose query string (if any) already
 * contains only allowlisted UTM keys — but this also works standalone
 * against an arbitrary URL string.
 */
export function parseUtmFromUrl(url: string | null): UtmParams {
  const empty: UtmParams = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
  };

  if (!url) {
    return empty;
  }

  try {
    const parsed = new URL(url);
    return {
      utmSource: cleanUtmValue(parsed.searchParams.get("utm_source") ?? ""),
      utmMedium: cleanUtmValue(parsed.searchParams.get("utm_medium") ?? ""),
      utmCampaign: cleanUtmValue(parsed.searchParams.get("utm_campaign") ?? ""),
      utmContent: cleanUtmValue(parsed.searchParams.get("utm_content") ?? ""),
      utmTerm: cleanUtmValue(parsed.searchParams.get("utm_term") ?? ""),
    };
  } catch {
    return empty;
  }
}

/**
 * Build page context from host-page signals. All fields are untrusted.
 * Landing URL is only set when explicitly provided (session start).
 */
export function buildPageContext(input: {
  url?: unknown;
  title?: unknown;
  referrer?: unknown;
  landingUrl?: unknown;
}): PageContext {
  const url = sanitizePageUrl(input.url);
  const title = sanitizePageTitle(input.title);
  const referrer = sanitizeReferrer(input.referrer);
  const landingUrl = sanitizePageUrl(input.landingUrl) ?? url;
  const utm = parseUtmFromUrl(url);

  return {
    url,
    title,
    referrer,
    landingUrl,
    ...utm,
  };
}

/**
 * Dedupe key for page views: same visitor session + URL within a window.
 */
export function pageViewDedupeKey(sessionId: string, url: string): string {
  return `${sessionId}|${url}`;
}

/**
 * Decide whether a SPA navigation should emit a new page view.
 * Sanitized URLs never carry a fragment, so hash-only navigation naturally
 * dedupes even when `hashIsNavigation` is left at its default.
 */
export function shouldRecordPageView(input: {
  previousUrl: string | null;
  nextUrl: string;
  hashIsNavigation?: boolean;
}): boolean {
  if (!input.previousUrl) {
    return true;
  }
  if (input.hashIsNavigation) {
    return input.previousUrl !== input.nextUrl;
  }
  try {
    const prev = new URL(input.previousUrl);
    const next = new URL(input.nextUrl);
    prev.hash = "";
    next.hash = "";
    return prev.toString() !== next.toString();
  } catch {
    return input.previousUrl !== input.nextUrl;
  }
}
