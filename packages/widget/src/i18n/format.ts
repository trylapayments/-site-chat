import {
  DEFAULT_WIDGET_LOCALE,
  getWidgetDirection as sharedGetWidgetDirection,
  type WidgetLocale,
  type WidgetTextDirection,
} from "@site-chat/shared";

/**
 * Visitor-facing timestamp policy:
 * - Format with the active canonical widget locale via `Intl.DateTimeFormat`.
 * - Use the visitor’s browser timezone (Intl default) unless a workspace
 *   timezone is explicitly configured later (not in this PR).
 * - Do not reuse the operator Inbox UTC display policy.
 * - Invalid timestamps degrade to an empty string (never throw).
 *
 * The widget iframe is client-rendered; still keep formatting pure/testable.
 */
export function formatMessageTime(
  iso: string,
  locale: WidgetLocale,
  now: Date = new Date(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(DEFAULT_WIDGET_LOCALE, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    } catch {
      void now;
      return "";
    }
  }
}

export function getWidgetDirection(locale: WidgetLocale): WidgetTextDirection {
  return sharedGetWidgetDirection(locale);
}

/**
 * Replace `{{name}}` / `{name}` placeholders in dictionary strings.
 */
export function formatWidgetMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}|\{([\w.]+)\}/g, (match, a, b) => {
    const key = typeof a === "string" ? a : typeof b === "string" ? b : "";
    if (!key || !Object.prototype.hasOwnProperty.call(vars, key)) {
      return match;
    }
    return vars[key] ?? match;
  });
}
