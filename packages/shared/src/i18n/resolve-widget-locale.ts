import {
  DEFAULT_WIDGET_LOCALE,
  isWidgetLocale,
  matchWidgetLocale,
  type WidgetLocale,
} from "./widget-locales";

export type ResolveWidgetLocaleInput = {
  /** Workspace / bootstrap config locale (highest priority when valid). */
  configLocale?: string | null;
  /**
   * Explicit embed override (e.g. future `data-locale`).
   * Only applied when present and valid; not currently wired in loader.
   */
  embedLocale?: string | null;
  /** `navigator.languages` in priority order. */
  browserLanguages?: readonly string[] | null;
  /** `navigator.language` fallback. */
  browserLocale?: string | null;
};

/**
 * Deterministic widget locale resolution.
 *
 * Order:
 * 1. Explicit workspace/widget locale from bootstrap config
 * 2. Explicit embed override (when provided by approved API)
 * 3. Browser `navigator.languages` (priority order)
 * 4. `navigator.language`
 * 5. English (`en`)
 *
 * Never throws. Always returns a supported canonical locale.
 * Call once per widget session and keep the result stable.
 */
export function resolveWidgetLocale(input: ResolveWidgetLocaleInput): WidgetLocale {
  const fromConfig = coerceCanonical(input.configLocale);
  if (fromConfig) {
    return fromConfig;
  }

  const fromEmbed = coerceCanonical(input.embedLocale);
  if (fromEmbed) {
    return fromEmbed;
  }

  const languages = input.browserLanguages;
  if (Array.isArray(languages)) {
    for (const tag of languages) {
      if (typeof tag !== "string") {
        continue;
      }
      const matched = matchWidgetLocale(tag);
      if (matched) {
        return matched;
      }
    }
  }

  const fromBrowser = matchWidgetLocale(input.browserLocale ?? null);
  if (fromBrowser) {
    return fromBrowser;
  }

  return DEFAULT_WIDGET_LOCALE;
}

/**
 * Coerce stored/API locale values: accept canonical codes and aliases;
 * invalid → null (caller falls through). Empty/malformed never throws.
 */
export function coerceCanonical(value: unknown): WidgetLocale | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  if (isWidgetLocale(value)) {
    return value;
  }

  return matchWidgetLocale(value);
}

/**
 * Normalize a value for persistence / Zod: invalid → English.
 * Use at API/SQL boundaries where a concrete locale is required.
 */
export function normalizeStoredWidgetLocale(value: unknown): WidgetLocale {
  return coerceCanonical(value) ?? DEFAULT_WIDGET_LOCALE;
}
