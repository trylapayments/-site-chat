import type { WidgetLocale } from "../i18n/widget-locales";
import type { WidgetLocalizedCopy } from "./schema";

/**
 * Resolve a localized copy field for a visitor locale.
 * Never falls back from an English override to other locales unless that locale
 * has its own override — system dictionary is used instead.
 */
export function resolveLocalizedCopy(input: {
  copy: WidgetLocalizedCopy | undefined | null;
  locale: WidgetLocale;
  systemFallback: string;
}): string {
  const copy = input.copy;
  if (!copy) {
    return input.systemFallback;
  }

  const override = copy.overrides?.[input.locale];
  if (typeof override === "string" && override.trim().length > 0) {
    return override;
  }

  if (copy.useSystemDefaults !== false) {
    return input.systemFallback;
  }

  // Custom mode with no override for this locale: still prefer system so
  // operators do not accidentally blank non-English locales.
  return input.systemFallback;
}

export function hasLocaleOverride(
  copy: WidgetLocalizedCopy | undefined | null,
  locale: WidgetLocale,
): boolean {
  if (!copy?.overrides) {
    return false;
  }
  const value = copy.overrides[locale];
  return typeof value === "string" && value.trim().length > 0;
}
