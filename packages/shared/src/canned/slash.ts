import { CANNED_SHORTCUT_PATTERN } from "../schemas/canned-responses.js";

export type SlashTrigger = {
  /** Query typed after the slash, without the slash itself. */
  query: string;
  /** Index of the `/` so the caller can replace `/query` wholesale. */
  replaceStart: number;
};

/**
 * Whether the canned-response autocomplete is active at the caret.
 *
 * Mirrors `detectMentionTrigger`, with two differences: the trigger is `/`
 * instead of `@`, and the query may not contain whitespace — a slash inside a
 * URL (`https://…`) or mid-word (`and/or`) must not open the menu because the
 * slash is not preceded by whitespace or start-of-input.
 */
export function detectSlashTrigger(body: string, caret: number): SlashTrigger | null {
  const clampedCaret = Math.max(0, Math.min(caret, body.length));
  const before = body.slice(0, clampedCaret);
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) {
    return null;
  }

  const slashIndex = before.lastIndexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  return {
    query: match[1] ?? "",
    replaceStart: slashIndex,
  };
}

/** Display form for a stored (slash-free) shortcut: `refund` → `/refund`. */
export function formatShortcutDisplay(shortcut: string | null | undefined): string {
  if (!shortcut) {
    return "";
  }
  const normalized = normalizeShortcutInput(shortcut);
  return normalized ? `/${normalized}` : "";
}

/**
 * Normalize operator input (`/Refund `, `refund`) to storage form.
 * Returns null for empty input, matching `normalize_canned_shortcut`.
 */
export function normalizeShortcutInput(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().replace(/^\/+/, "").trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

export function isValidShortcut(raw: string | null | undefined): boolean {
  const normalized = normalizeShortcutInput(raw);
  if (normalized === null) {
    // No shortcut is valid — the field is optional.
    return true;
  }
  return CANNED_SHORTCUT_PATTERN.test(normalized);
}

/**
 * Replace the active `/query` with `replacement`, returning the next body and
 * caret position. A trailing space is not added: snippet bodies usually end a
 * sentence, and callers place the caret at the end of the inserted text.
 */
export function replaceSlashTrigger(
  body: string,
  caret: number,
  replacement: string,
): { body: string; caret: number } | null {
  const trigger = detectSlashTrigger(body, caret);
  if (!trigger) {
    return null;
  }
  const clampedCaret = Math.max(0, Math.min(caret, body.length));
  const before = body.slice(0, trigger.replaceStart);
  const after = body.slice(clampedCaret);
  return {
    body: `${before}${replacement}${after}`,
    caret: before.length + replacement.length,
  };
}
