import type { CannedResponse } from "../schemas/canned-responses.js";
import { normalizeShortcutInput } from "./slash.js";

export const CANNED_SLASH_MENU_LIMIT = 8;

/** Whether every char of `needle` appears in `haystack` in order. */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) {
    return true;
  }
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Client-side rank for an already-loaded snippet list (slash menu, settings
 * search). Deliberately coarser than `list_canned_responses`: it never replaces
 * the SQL search, it just keeps an in-memory list responsive while typing.
 *
 * Weights follow the same intent as the RPC: exact shortcut wins outright, then
 * shortcut prefix, then title, then body, with a nudge for favorites.
 */
export function scoreCannedResponse(item: CannedResponse, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return item.is_favorited ? 0.05 : 0.01;
  }

  const shortcutNeedle = normalizeShortcutInput(needle);
  const shortcut = item.shortcut ?? "";
  const title = item.title.toLowerCase();
  const body = item.body.toLowerCase();

  let score = 0;

  if (shortcut && shortcutNeedle) {
    if (shortcut === shortcutNeedle) {
      score = 1;
    } else if (shortcut.startsWith(shortcutNeedle)) {
      score = 0.7;
    } else if (shortcut.includes(shortcutNeedle)) {
      score = 0.35;
    } else if (isSubsequence(shortcutNeedle, shortcut)) {
      score = 0.12;
    }
  }

  if (title.startsWith(needle)) {
    score = Math.max(score, 0.5);
  } else if (title.includes(needle)) {
    score = Math.max(score, 0.4);
  } else if (isSubsequence(needle, title)) {
    score = Math.max(score, 0.15);
  }

  if (body.includes(needle)) {
    score = Math.max(score, 0.2);
  }

  if (score === 0) {
    return 0;
  }

  return item.is_favorited ? score + 0.05 : score;
}

function compareOnTie(a: CannedResponse, b: CannedResponse): number {
  // A member's own snippet shadows a shared one with the same shortcut, matching
  // the personal-first resolution documented in docs/CANNED-RESPONSES.md.
  if (a.visibility !== b.visibility) {
    return a.visibility === "personal" ? -1 : 1;
  }
  if (a.usage_count !== b.usage_count) {
    return b.usage_count - a.usage_count;
  }
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) {
    return byTitle;
  }
  return a.id.localeCompare(b.id);
}

/** Rank every matching snippet (no truncation) — used by settings search. */
export function rankCannedResponses(
  items: readonly CannedResponse[],
  query: string,
): CannedResponse[] {
  const scored = items
    .map((item) => ({ item, score: scoreCannedResponse(item, query) }))
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return compareOnTie(a.item, b.item);
  });

  return scored.map((entry) => entry.item);
}

/**
 * Ranked candidates for the composer slash menu, truncated to a keyboard-sized
 * list. An exact shortcut match is always first so `/refund` + Enter is
 * deterministic.
 */
export function filterCannedResponsesForSlash(
  items: readonly CannedResponse[],
  query: string,
  options: { limit?: number } = {},
): CannedResponse[] {
  const limit = options.limit ?? CANNED_SLASH_MENU_LIMIT;
  return rankCannedResponses(items, query).slice(0, Math.max(1, limit));
}

/**
 * Resolve a typed shortcut to a single snippet (personal shadows shared).
 * Returns null when nothing matches exactly.
 */
export function findCannedResponseByShortcut(
  items: readonly CannedResponse[],
  shortcut: string,
): CannedResponse | null {
  const needle = normalizeShortcutInput(shortcut);
  if (!needle) {
    return null;
  }
  const matches = items.filter((item) => item.shortcut === needle);
  if (matches.length === 0) {
    return null;
  }
  return [...matches].sort(compareOnTie)[0] ?? null;
}
