export {
  DEFAULT_WIDGET_LOCALE,
  getWidgetDirection,
  getWidgetLocaleDefinition,
  isWidgetLocale,
  matchWidgetLocale,
  normalizeLocaleTag,
  RTL_WIDGET_LOCALES,
  WIDGET_LOCALE_CODES,
  WIDGET_LOCALE_DEFINITIONS,
  WIDGET_LOCALE_SOURCE,
  type WidgetLocaleDefinition,
  type WidgetTextDirection,
} from "./widget-locales";

export {
  coerceCanonical,
  normalizeStoredWidgetLocale,
  resolveWidgetLocale,
  type ResolveWidgetLocaleInput,
} from "./resolve-widget-locale";

// WidgetLocale is exported from schemas/widget.ts to avoid duplicate export * collisions.
