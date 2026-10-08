/**
 * Canonical widget locale registry.
 *
 * Source of truth for supported visitor-widget languages. Minimum set matches
 * LiveChat’s published widget language list (48 languages), verified from:
 * https://www.livechat.com/help/how-to-modify-chat-window-language/
 *
 * Verified: 2026-08-06 (LiveChat help article last updated Dec 5, 2024).
 * Official count: 48 languages.
 *
 * Interface localization only — this is not message-body translation.
 */

export const WIDGET_LOCALE_SOURCE = {
  url: "https://www.livechat.com/help/how-to-modify-chat-window-language/",
  verifiedDate: "2026-08-06",
  articleUpdated: "2024-12-05",
  officialLanguageCount: 48,
} as const;

export type WidgetTextDirection = "ltr" | "rtl";

export type WidgetLocaleDefinition = {
  /** Canonical BCP 47 tag stored in config / sessions. */
  code: string;
  /** Stable internal key (same as code for this registry). */
  key: string;
  /** English language name (for operator-facing lists later). */
  englishName: string;
  /** Native language name. */
  nativeName: string;
  /** Text direction for chrome UI. */
  direction: WidgetTextDirection;
  /**
   * Browser / Accept-Language aliases that map to this locale.
   * Matching normalizes case and `_` → `-`.
   */
  aliases: readonly string[];
  /** Optional fallback before English (unused today; reserved). */
  fallbackLocale?: string;
};

/**
 * Canonical locale codes — order matches LiveChat’s published list.
 * Region variants use BCP 47 with capitalized region (matches DB check
 * `^[a-z]{2}(-[A-Z]{2})?$`).
 */
export const WIDGET_LOCALE_DEFINITIONS = [
  {
    code: "ar",
    key: "ar",
    englishName: "Arabic",
    nativeName: "العربية",
    direction: "rtl",
    aliases: [
      "ar",
      "ar-SA",
      "ar-EG",
      "ar-AE",
      "ar-MA",
      "ar-DZ",
      "ar-IQ",
      "ar-JO",
      "ar-KW",
      "ar-LB",
    ],
  },
  {
    code: "hy",
    key: "hy",
    englishName: "Armenian",
    nativeName: "Հայերեն",
    direction: "ltr",
    aliases: ["hy", "hy-AM"],
  },
  {
    code: "az",
    key: "az",
    englishName: "Azeri",
    nativeName: "Azərbaycan",
    direction: "ltr",
    aliases: ["az", "az-AZ", "az-Latn", "az-Latn-AZ"],
  },
  {
    code: "bg",
    key: "bg",
    englishName: "Bulgarian",
    nativeName: "Български",
    direction: "ltr",
    aliases: ["bg", "bg-BG"],
  },
  {
    code: "ca",
    key: "ca",
    englishName: "Catalan",
    nativeName: "Català",
    direction: "ltr",
    aliases: ["ca", "ca-ES", "ca-AD"],
  },
  {
    code: "zh-CN",
    key: "zh-CN",
    englishName: "Simplified Chinese",
    nativeName: "简体中文",
    direction: "ltr",
    aliases: ["zh-CN", "zh-Hans", "zh-Hans-CN", "zh-SG", "zh-Hans-SG"],
  },
  {
    code: "zh-TW",
    key: "zh-TW",
    englishName: "Traditional Chinese",
    nativeName: "繁體中文",
    direction: "ltr",
    aliases: ["zh-TW", "zh-Hant", "zh-Hant-TW", "zh-HK", "zh-Hant-HK", "zh-MO", "zh-Hant-MO"],
  },
  {
    code: "hr",
    key: "hr",
    englishName: "Croatian",
    nativeName: "Hrvatski",
    direction: "ltr",
    aliases: ["hr", "hr-HR"],
  },
  {
    code: "cs",
    key: "cs",
    englishName: "Czech",
    nativeName: "Čeština",
    direction: "ltr",
    aliases: ["cs", "cs-CZ"],
  },
  {
    code: "da",
    key: "da",
    englishName: "Danish",
    nativeName: "Dansk",
    direction: "ltr",
    aliases: ["da", "da-DK"],
  },
  {
    code: "nl",
    key: "nl",
    englishName: "Dutch",
    nativeName: "Nederlands",
    direction: "ltr",
    aliases: ["nl", "nl-NL", "nl-BE"],
  },
  {
    code: "en",
    key: "en",
    englishName: "English",
    nativeName: "English",
    direction: "ltr",
    aliases: ["en", "en-US", "en-GB", "en-AU", "en-CA", "en-NZ", "en-IE", "en-ZA", "en-IN"],
  },
  {
    code: "et",
    key: "et",
    englishName: "Estonian",
    nativeName: "Eesti",
    direction: "ltr",
    aliases: ["et", "et-EE"],
  },
  {
    code: "fa",
    key: "fa",
    englishName: "Farsi/Persian",
    nativeName: "فارسی",
    direction: "rtl",
    aliases: ["fa", "fa-IR", "fa-AF", "per", "pes"],
  },
  {
    code: "fi",
    key: "fi",
    englishName: "Finnish",
    nativeName: "Suomi",
    direction: "ltr",
    aliases: ["fi", "fi-FI"],
  },
  {
    code: "fr",
    key: "fr",
    englishName: "French",
    nativeName: "Français",
    direction: "ltr",
    aliases: ["fr", "fr-FR", "fr-CA", "fr-BE", "fr-CH"],
  },
  {
    code: "ka",
    key: "ka",
    englishName: "Georgian",
    nativeName: "ქართული",
    direction: "ltr",
    aliases: ["ka", "ka-GE"],
  },
  {
    code: "de",
    key: "de",
    englishName: "German",
    nativeName: "Deutsch",
    direction: "ltr",
    aliases: ["de", "de-DE", "de-AT", "de-CH"],
  },
  {
    code: "el",
    key: "el",
    englishName: "Greek",
    nativeName: "Ελληνικά",
    direction: "ltr",
    aliases: ["el", "el-GR", "el-CY"],
  },
  {
    code: "he",
    key: "he",
    englishName: "Hebrew",
    nativeName: "עברית",
    direction: "rtl",
    aliases: ["he", "he-IL", "iw", "iw-IL"],
  },
  {
    code: "hi",
    key: "hi",
    englishName: "Hindi",
    nativeName: "हिन्दी",
    direction: "ltr",
    aliases: ["hi", "hi-IN"],
  },
  {
    code: "hu",
    key: "hu",
    englishName: "Hungarian",
    nativeName: "Magyar",
    direction: "ltr",
    aliases: ["hu", "hu-HU"],
  },
  {
    code: "is",
    key: "is",
    englishName: "Icelandic",
    nativeName: "Íslenska",
    direction: "ltr",
    aliases: ["is", "is-IS"],
  },
  {
    code: "id",
    key: "id",
    englishName: "Indonesian",
    nativeName: "Bahasa Indonesia",
    direction: "ltr",
    aliases: ["id", "id-ID", "in", "in-ID"],
  },
  {
    code: "it",
    key: "it",
    englishName: "Italian",
    nativeName: "Italiano",
    direction: "ltr",
    aliases: ["it", "it-IT", "it-CH"],
  },
  {
    code: "ja",
    key: "ja",
    englishName: "Japanese",
    nativeName: "日本語",
    direction: "ltr",
    aliases: ["ja", "ja-JP"],
  },
  {
    code: "kk",
    key: "kk",
    englishName: "Kazakh",
    nativeName: "Қазақ тілі",
    direction: "ltr",
    aliases: ["kk", "kk-KZ"],
  },
  {
    code: "ko",
    key: "ko",
    englishName: "Korean",
    nativeName: "한국어",
    direction: "ltr",
    aliases: ["ko", "ko-KR"],
  },
  {
    code: "lv",
    key: "lv",
    englishName: "Latvian",
    nativeName: "Latviešu",
    direction: "ltr",
    aliases: ["lv", "lv-LV"],
  },
  {
    code: "lt",
    key: "lt",
    englishName: "Lithuanian",
    nativeName: "Lietuvių",
    direction: "ltr",
    aliases: ["lt", "lt-LT"],
  },
  {
    code: "mg",
    key: "mg",
    englishName: "Malagasy",
    nativeName: "Malagasy",
    direction: "ltr",
    aliases: ["mg", "mg-MG"],
  },
  {
    code: "ms",
    key: "ms",
    englishName: "Malaysian",
    nativeName: "Bahasa Melayu",
    direction: "ltr",
    aliases: ["ms", "ms-MY", "ms-BN", "ms-SG"],
  },
  {
    code: "nb",
    key: "nb",
    englishName: "Norwegian (bokmål)",
    nativeName: "Norsk bokmål",
    direction: "ltr",
    aliases: ["nb", "nb-NO", "no", "no-NO", "nor"],
  },
  {
    code: "nn",
    key: "nn",
    englishName: "Norwegian (nynorsk)",
    nativeName: "Norsk nynorsk",
    direction: "ltr",
    aliases: ["nn", "nn-NO"],
  },
  {
    code: "pl",
    key: "pl",
    englishName: "Polish",
    nativeName: "Polski",
    direction: "ltr",
    aliases: ["pl", "pl-PL"],
  },
  {
    code: "pt-PT",
    key: "pt-PT",
    englishName: "Portuguese",
    nativeName: "Português",
    direction: "ltr",
    aliases: ["pt-PT", "pt"],
  },
  {
    code: "pt-BR",
    key: "pt-BR",
    englishName: "Brazilian Portuguese",
    nativeName: "Português (Brasil)",
    direction: "ltr",
    aliases: ["pt-BR"],
  },
  {
    code: "ro",
    key: "ro",
    englishName: "Romanian",
    nativeName: "Română",
    direction: "ltr",
    aliases: ["ro", "ro-RO", "ro-MD"],
  },
  {
    code: "ru",
    key: "ru",
    englishName: "Russian",
    nativeName: "Русский",
    direction: "ltr",
    aliases: ["ru", "ru-RU", "ru-BY", "ru-KZ", "ru-UA"],
  },
  {
    code: "sr",
    key: "sr",
    englishName: "Serbian",
    nativeName: "Српски",
    direction: "ltr",
    aliases: ["sr", "sr-RS", "sr-Cyrl", "sr-Cyrl-RS", "sr-Latn", "sr-Latn-RS"],
  },
  {
    code: "sk",
    key: "sk",
    englishName: "Slovak",
    nativeName: "Slovenčina",
    direction: "ltr",
    aliases: ["sk", "sk-SK"],
  },
  {
    code: "sl",
    key: "sl",
    englishName: "Slovene",
    nativeName: "Slovenščina",
    direction: "ltr",
    aliases: ["sl", "sl-SI"],
  },
  {
    code: "es",
    key: "es",
    englishName: "Spanish",
    nativeName: "Español",
    direction: "ltr",
    aliases: ["es", "es-ES", "es-MX", "es-AR", "es-CO", "es-CL", "es-PE", "es-US", "es-419"],
  },
  {
    code: "sv",
    key: "sv",
    englishName: "Swedish",
    nativeName: "Svenska",
    direction: "ltr",
    aliases: ["sv", "sv-SE", "sv-FI"],
  },
  {
    code: "th",
    key: "th",
    englishName: "Thai",
    nativeName: "ไทย",
    direction: "ltr",
    aliases: ["th", "th-TH"],
  },
  {
    code: "tr",
    key: "tr",
    englishName: "Turkish",
    nativeName: "Türkçe",
    direction: "ltr",
    aliases: ["tr", "tr-TR"],
  },
  {
    code: "uk",
    key: "uk",
    englishName: "Ukrainian",
    nativeName: "Українська",
    direction: "ltr",
    aliases: ["uk", "uk-UA"],
  },
  {
    code: "vi",
    key: "vi",
    englishName: "Vietnamese",
    nativeName: "Tiếng Việt",
    direction: "ltr",
    aliases: ["vi", "vi-VN"],
  },
] as const satisfies readonly WidgetLocaleDefinition[];

export type WidgetLocale = (typeof WIDGET_LOCALE_DEFINITIONS)[number]["code"];

export const WIDGET_LOCALE_CODES = WIDGET_LOCALE_DEFINITIONS.map(
  (locale) => locale.code,
) as unknown as readonly [WidgetLocale, ...WidgetLocale[]];

export const DEFAULT_WIDGET_LOCALE: WidgetLocale = "en";

export const RTL_WIDGET_LOCALES: readonly WidgetLocale[] = WIDGET_LOCALE_DEFINITIONS.filter(
  (locale) => locale.direction === "rtl",
).map((locale) => locale.code);

const DEFINITION_BY_CODE = new Map<string, (typeof WIDGET_LOCALE_DEFINITIONS)[number]>(
  WIDGET_LOCALE_DEFINITIONS.map((locale) => [locale.code, locale]),
);

/** Normalized alias → canonical code. Longer / more specific aliases win via exact match. */
const ALIAS_TO_CANONICAL = (() => {
  const map = new Map<string, WidgetLocale>();

  for (const locale of WIDGET_LOCALE_DEFINITIONS) {
    map.set(normalizeLocaleTag(locale.code), locale.code);
    for (const alias of locale.aliases) {
      map.set(normalizeLocaleTag(alias), locale.code);
    }
  }

  return map;
})();

export function normalizeLocaleTag(input: string): string {
  return input.trim().replace(/_/g, "-").toLowerCase();
}

export function isWidgetLocale(value: unknown): value is WidgetLocale {
  return typeof value === "string" && DEFINITION_BY_CODE.has(value);
}

export function getWidgetLocaleDefinition(
  locale: WidgetLocale,
): (typeof WIDGET_LOCALE_DEFINITIONS)[number] {
  const definition = DEFINITION_BY_CODE.get(locale);
  if (definition) {
    return definition;
  }
  const fallback = DEFINITION_BY_CODE.get(DEFAULT_WIDGET_LOCALE);
  if (fallback) {
    return fallback;
  }
  return WIDGET_LOCALE_DEFINITIONS[0];
}

export function getWidgetDirection(locale: WidgetLocale): WidgetTextDirection {
  return getWidgetLocaleDefinition(locale).direction;
}

/**
 * Match a single language tag to a canonical widget locale.
 * Tries exact alias, then language-region, then primary language subtag.
 * Special-cases Chinese and Portuguese region/script variants.
 */
export function matchWidgetLocale(tag: string | null | undefined): WidgetLocale | null {
  if (tag == null || typeof tag !== "string") {
    return null;
  }

  const normalized = normalizeLocaleTag(tag);
  if (!normalized) {
    return null;
  }

  const exact = ALIAS_TO_CANONICAL.get(normalized);
  if (exact) {
    return exact;
  }

  const parts = normalized.split("-").filter(Boolean);
  const language = parts[0];
  if (!language) {
    return null;
  }

  // Chinese: prefer Hans → zh-CN, Hant → zh-TW; region CN/SG → CN; TW/HK/MO → TW
  if (language === "zh") {
    const rest = parts.slice(1);
    if (rest.some((part) => part === "hant" || part === "tw" || part === "hk" || part === "mo")) {
      return "zh-TW";
    }
    if (rest.some((part) => part === "hans" || part === "cn" || part === "sg")) {
      return "zh-CN";
    }
    // Bare "zh" → Simplified (most common default)
    return "zh-CN";
  }

  // Portuguese: bare "pt" → pt-PT; BR → pt-BR
  if (language === "pt") {
    if (parts.some((part) => part === "br")) {
      return "pt-BR";
    }
    return "pt-PT";
  }

  // Norwegian: bare "no" → bokmål
  if (language === "no") {
    return "nb";
  }

  // Try language + region (e.g. en-gb already tried as exact via aliases)
  const region = parts[1];
  if (region) {
    const languageRegion = `${language}-${region}`;
    const byRegion = ALIAS_TO_CANONICAL.get(languageRegion);
    if (byRegion) {
      return byRegion;
    }
  }

  const byLanguage = ALIAS_TO_CANONICAL.get(language);
  if (byLanguage) {
    return byLanguage;
  }

  return null;
}
