import {
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

function clampText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Sanitize an untrusted URL from the host page.
 * Rejects javascript:/data:/vbscript: and non-http(s) schemes.
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

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // Drop credentials if present.
  parsed.username = "";
  parsed.password = "";

  return clampText(parsed.toString(), VISITOR_URL_MAX_LENGTH);
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
  // Referrer may be opaque ("") or a relative string on some browsers;
  // prefer absolute http(s) when parseable, otherwise store bounded text.
  const asUrl = sanitizePageUrl(cleaned);
  if (asUrl) {
    return asUrl;
  }
  if (/^(javascript|data|vbscript):/i.test(cleaned)) {
    return null;
  }
  return clampText(cleaned, VISITOR_REFERRER_MAX_LENGTH);
}

function readUtm(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  if (!value) {
    return null;
  }
  const cleaned = stripControlChars(value).trim();
  if (cleaned.length === 0) {
    return null;
  }
  return clampText(cleaned, VISITOR_UTM_MAX_LENGTH);
}

export function parseUtmFromUrl(url: string | null): UtmParams {
  if (!url) {
    return {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    };
  }

  try {
    const parsed = new URL(url);
    return {
      utmSource: readUtm(parsed.searchParams, "utm_source"),
      utmMedium: readUtm(parsed.searchParams, "utm_medium"),
      utmCampaign: readUtm(parsed.searchParams, "utm_campaign"),
      utmContent: readUtm(parsed.searchParams, "utm_content"),
      utmTerm: readUtm(parsed.searchParams, "utm_term"),
    };
  } catch {
    return {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    };
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
 * Same URL (ignoring hash-only changes when hashIsNavigation=false) is skipped.
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
