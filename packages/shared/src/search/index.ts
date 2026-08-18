/**
 * Normalize an operator global-search query for client debounce / keyboard UI.
 * Mirrors server trim + max length; does not invent tokens.
 */
import {
  GLOBAL_SEARCH_CATEGORIES,
  GLOBAL_SEARCH_MIN_FUZZY_LENGTH,
  GLOBAL_SEARCH_QUERY_MAX_LENGTH,
  type GlobalSearchCategory,
  type GlobalSearchGroups,
  type GlobalSearchHit,
  type GlobalSearchResult,
  type GlobalSearchResultType,
} from "../schemas/global-search.js";

export function normalizeSearchQuery(raw: string): string {
  return raw.split("\u0000").join("").trim().slice(0, GLOBAL_SEARCH_QUERY_MAX_LENGTH);
}

/** True when the server will run FTS / substring body/filename scans. */
export function isFuzzySearchQuery(raw: string): boolean {
  return normalizeSearchQuery(raw).length >= GLOBAL_SEARCH_MIN_FUZZY_LENGTH;
}

/**
 * Escape `%`, `_`, and `\` for SQL LIKE/ILIKE with `ESCAPE '\'`.
 * Mirrors `app_private.escape_like_pattern`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function isValidSearchCategory(value: string): value is GlobalSearchCategory {
  return (GLOBAL_SEARCH_CATEGORIES as readonly string[]).includes(value);
}

export function parseSearchCategory(value: string | null | undefined): GlobalSearchCategory {
  if (value && isValidSearchCategory(value)) {
    return value;
  }
  return "all";
}

/** Categories visible in the palette for the caller's role. */
export function visibleSearchCategories(canSearchNotes: boolean): GlobalSearchCategory[] {
  if (canSearchNotes) {
    return [...GLOBAL_SEARCH_CATEGORIES];
  }
  return GLOBAL_SEARCH_CATEGORIES.filter((category) => category !== "notes");
}

export function flattenSearchHits(groups: GlobalSearchGroups): GlobalSearchHit[] {
  return [
    ...groups.contacts,
    ...groups.conversations,
    ...groups.messages,
    ...groups.notes,
    ...groups.attachments,
  ];
}

export function groupLabelForType(type: GlobalSearchResultType): string {
  switch (type) {
    case "contact":
      return "Contacts";
    case "conversation":
      return "Conversations";
    case "message":
      return "Messages";
    case "note":
      return "Internal Notes";
    case "attachment":
      return "Attachments";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function categoryForResultType(type: GlobalSearchResultType): GlobalSearchCategory {
  switch (type) {
    case "contact":
      return "contacts";
    case "conversation":
      return "conversations";
    case "message":
      return "messages";
    case "note":
      return "notes";
    case "attachment":
      return "attachments";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Strip characters that could be interpreted as HTML when rendering snippets.
 * Server already strips `<>`; this is defense-in-depth for any mapper path.
 */
export function sanitizeSearchSnippet(snippet: string | null | undefined): string | null {
  if (snippet == null) {
    return null;
  }
  const cleaned = snippet.replace(/[<>]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function mapSearchHit(raw: GlobalSearchHit): GlobalSearchHit {
  return {
    ...raw,
    title: raw.title.replace(/[<>]/g, ""),
    subtitle: raw.subtitle == null ? null : raw.subtitle.replace(/[<>]/g, ""),
    snippet: sanitizeSearchSnippet(raw.snippet),
  };
}

export function mapSearchResult(result: GlobalSearchResult): GlobalSearchResult {
  return {
    ...result,
    groups: {
      contacts: result.groups.contacts.map(mapSearchHit),
      conversations: result.groups.conversations.map(mapSearchHit),
      messages: result.groups.messages.map(mapSearchHit),
      notes: result.groups.notes.map(mapSearchHit),
      attachments: result.groups.attachments.map(mapSearchHit),
    },
  };
}

/**
 * Client-side deterministic re-rank for already-fetched hits (palette merge).
 * Exact email / phone / uuid-ish ids win; then prefix; then FTS rank; recency last.
 */
export function compareSearchHits(a: GlobalSearchHit, b: GlobalSearchHit): number {
  if (a.rank !== b.rank) {
    return b.rank - a.rank;
  }
  const aTs = a.timestamp ? Date.parse(a.timestamp) : 0;
  const bTs = b.timestamp ? Date.parse(b.timestamp) : 0;
  if (aTs !== bTs) {
    return bTs - aTs;
  }
  return a.id.localeCompare(b.id);
}

export function rankSearchHits(hits: readonly GlobalSearchHit[]): GlobalSearchHit[] {
  return [...hits].sort(compareSearchHits);
}

/** Boost heuristic used in unit tests + optional client re-score. */
export function scoreExactIdentityMatch(
  query: string,
  candidates: { email?: string | null; phone?: string | null; publicId?: string | null },
): number {
  const needle = normalizeSearchQuery(query).toLowerCase();
  if (!needle) {
    return 0;
  }
  if (candidates.email && candidates.email.toLowerCase() === needle) {
    return 100;
  }
  if (candidates.publicId && candidates.publicId.toLowerCase() === needle) {
    return 100;
  }
  const needleDigits = needle.replace(/\D/g, "");
  const phoneDigits = (candidates.phone ?? "").replace(/\D/g, "");
  if (needleDigits.length >= 7 && phoneDigits.length > 0 && needleDigits === phoneDigits) {
    return 100;
  }
  if (candidates.email && candidates.email.toLowerCase().startsWith(needle)) {
    return 80;
  }
  return 0;
}

export type SearchKeyboardAction =
  | { type: "noop" }
  | { type: "close" }
  | { type: "open" }
  | { type: "move"; delta: number }
  | { type: "select" };

export function resolveSearchKeyboardAction(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  open: boolean;
  hasSelection: boolean;
}): SearchKeyboardAction {
  const { key, metaKey, ctrlKey, altKey, open, hasSelection } = input;

  if ((metaKey || ctrlKey) && !altKey && key.toLowerCase() === "k") {
    return open ? { type: "close" } : { type: "open" };
  }

  if (!open) {
    return { type: "noop" };
  }

  if (key === "Escape") {
    return { type: "close" };
  }
  if (key === "ArrowDown") {
    return { type: "move", delta: 1 };
  }
  if (key === "ArrowUp") {
    return { type: "move", delta: -1 };
  }
  if (key === "Enter" && hasSelection) {
    return { type: "select" };
  }
  return { type: "noop" };
}

export function clampSearchIndex(index: number, length: number): number {
  if (length <= 0) {
    return -1;
  }
  if (index < 0) {
    return 0;
  }
  if (index >= length) {
    return length - 1;
  }
  return index;
}

/** Filter note hits when the caller lacks notes capability (defense-in-depth). */
export function filterHitsForPermissions(
  result: GlobalSearchResult,
  canSearchNotes: boolean,
): GlobalSearchResult {
  if (canSearchNotes) {
    return result;
  }
  return {
    ...result,
    can_search_notes: false,
    groups: {
      ...result.groups,
      notes: [],
    },
  };
}
