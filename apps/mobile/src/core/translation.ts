export const translationLanguages = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
  ru: "Russian",
  tr: "Turkish",
  ar: "Arabic",
  he: "Hebrew",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
} as const;
export type TranslationLanguage = keyof typeof translationLanguages;
export type TranslationPreview = {
  source: string;
  translatedText: string;
  targetLanguage: TranslationLanguage;
};

// Only a preview of the exact current draft may become a sent message.
// Company/account/conversation changes invalidate a pending result as well.
export function acceptTranslationPreview(
  preview: TranslationPreview,
  draft: string,
  requestedScope: string,
  currentScope: string,
  target: TranslationLanguage,
): string | null {
  if (
    !requestedScope ||
    requestedScope !== currentScope ||
    preview.source !== draft ||
    preview.targetLanguage !== target ||
    !preview.translatedText.trim()
  )
    return null;
  return preview.translatedText;
}
