import type { WidgetLocale } from "@site-chat/shared";

import type { WidgetMessages } from "./types";
import en from "./locales/en";

/**
 * Locale → dictionary module loaders.
 * English is also available synchronously via `englishMessages` for fallback
 * and first paint; other locales are code-split into hashed chunks under
 * `/widget/assets/` (same origin → CSP `script-src 'self'`).
 */
export const dictionaryLoaders: Record<WidgetLocale, () => Promise<{ default: WidgetMessages }>> = {
  ar: () => import("./locales/ar"),
  hy: () => import("./locales/hy"),
  az: () => import("./locales/az"),
  bg: () => import("./locales/bg"),
  ca: () => import("./locales/ca"),
  "zh-CN": () => import("./locales/zh-CN"),
  "zh-TW": () => import("./locales/zh-TW"),
  hr: () => import("./locales/hr"),
  cs: () => import("./locales/cs"),
  da: () => import("./locales/da"),
  nl: () => import("./locales/nl"),
  en: () => Promise.resolve({ default: en }),
  et: () => import("./locales/et"),
  fa: () => import("./locales/fa"),
  fi: () => import("./locales/fi"),
  fr: () => import("./locales/fr"),
  ka: () => import("./locales/ka"),
  de: () => import("./locales/de"),
  el: () => import("./locales/el"),
  he: () => import("./locales/he"),
  hi: () => import("./locales/hi"),
  hu: () => import("./locales/hu"),
  is: () => import("./locales/is"),
  id: () => import("./locales/id"),
  it: () => import("./locales/it"),
  ja: () => import("./locales/ja"),
  kk: () => import("./locales/kk"),
  ko: () => import("./locales/ko"),
  lv: () => import("./locales/lv"),
  lt: () => import("./locales/lt"),
  mg: () => import("./locales/mg"),
  ms: () => import("./locales/ms"),
  nb: () => import("./locales/nb"),
  nn: () => import("./locales/nn"),
  pl: () => import("./locales/pl"),
  "pt-PT": () => import("./locales/pt-PT"),
  "pt-BR": () => import("./locales/pt-BR"),
  ro: () => import("./locales/ro"),
  ru: () => import("./locales/ru"),
  sr: () => import("./locales/sr"),
  sk: () => import("./locales/sk"),
  sl: () => import("./locales/sl"),
  es: () => import("./locales/es"),
  sv: () => import("./locales/sv"),
  th: () => import("./locales/th"),
  tr: () => import("./locales/tr"),
  uk: () => import("./locales/uk"),
  vi: () => import("./locales/vi"),
};

export const englishMessages: WidgetMessages = en;

const cache = new Map<WidgetLocale, WidgetMessages>();
cache.set("en", englishMessages);

/**
 * Load dictionary for a canonical locale. On chunk failure, falls back to English.
 * Results are cached for the widget session.
 */
export async function loadWidgetDictionary(locale: WidgetLocale): Promise<WidgetMessages> {
  const cached = cache.get(locale);
  if (cached) {
    return cached;
  }

  try {
    const mod = await dictionaryLoaders[locale]();
    const messages = mod.default;
    cache.set(locale, messages);
    return messages;
  } catch {
    return englishMessages;
  }
}

export function getCachedWidgetDictionary(locale: WidgetLocale): WidgetMessages {
  return cache.get(locale) ?? englishMessages;
}

/** @internal Test helper */
export function __resetDictionaryCacheForTests(): void {
  cache.clear();
  cache.set("en", englishMessages);
}
