/**
 * Strip control characters (except newline/tab) from model or user text
 * before insertion into the composer. Messages are plain text only.
 */
export function sanitizePlainText(input: string, maxLength = 4000): string {
  // Intentionally strip C0 controls (except TAB/LF) from untrusted text.
  // eslint-disable-next-line no-control-regex -- sanitizing control chars
  const withoutNulls = input.replace(/\u0000/g, "");
  const withoutControls = withoutNulls.replace(
    // eslint-disable-next-line no-control-regex -- sanitizing control chars
    /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
  return withoutControls.trim().slice(0, maxLength);
}

/**
 * Escape HTML entities if suggestion text is ever rendered via innerHTML.
 * Operator UI should prefer React text nodes; this is defense in depth.
 */
export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Detect obvious HTML/script payloads for logging-safe classification only.
 * Does not block generation; UI must still render as text.
 */
export function looksLikeHtmlPayload(input: string): boolean {
  return /<\s*(script|iframe|img|svg|object|embed|link|style)\b/i.test(input);
}
