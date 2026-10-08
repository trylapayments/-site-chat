export const TRANSLATION_LANGUAGES = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", pl: "Polish", uk: "Ukrainian", ru: "Russian",
  tr: "Turkish", ar: "Arabic", he: "Hebrew", hi: "Hindi", ja: "Japanese",
  ko: "Korean", zh: "Chinese", sv: "Swedish", da: "Danish", fi: "Finnish",
} as const;
export type TranslationLanguage = keyof typeof TRANSLATION_LANGUAGES;
