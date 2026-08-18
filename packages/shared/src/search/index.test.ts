import { describe, expect, it } from "vitest";

import { emptyGlobalSearchResult, type GlobalSearchHit } from "../schemas/global-search.js";
import {
  clampSearchIndex,
  compareSearchHits,
  filterHitsForPermissions,
  flattenSearchHits,
  mapSearchHit,
  normalizeSearchQuery,
  parseSearchCategory,
  rankSearchHits,
  resolveSearchKeyboardAction,
  sanitizeSearchSnippet,
  scoreExactIdentityMatch,
  visibleSearchCategories,
} from "./index.js";

describe("normalizeSearchQuery", () => {
  it("trims and strips null bytes", () => {
    expect(normalizeSearchQuery("  hello\u0000 world  ")).toBe("hello world");
  });

  it("enforces max length", () => {
    expect(normalizeSearchQuery("a".repeat(250)).length).toBe(200);
  });
});

describe("parseSearchCategory / visibleSearchCategories", () => {
  it("defaults unknown categories to all", () => {
    expect(parseSearchCategory("nope")).toBe("all");
    expect(parseSearchCategory("messages")).toBe("messages");
  });

  it("hides notes category for viewers", () => {
    expect(visibleSearchCategories(false)).not.toContain("notes");
    expect(visibleSearchCategories(true)).toContain("notes");
  });
});

describe("ranking", () => {
  const base = (overrides: Partial<GlobalSearchHit>): GlobalSearchHit => ({
    type: "contact",
    id: "11111111-1111-1111-1111-111111111111",
    title: "A",
    subtitle: null,
    snippet: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    conversation_id: null,
    contact_id: null,
    message_id: null,
    rank: 10,
    ...overrides,
  });

  it("prefers higher rank then newer timestamp", () => {
    const hits = rankSearchHits([
      base({
        id: "22222222-2222-2222-2222-222222222222",
        rank: 50,
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      base({
        id: "33333333-3333-3333-3333-333333333333",
        rank: 90,
        timestamp: "2025-01-01T00:00:00.000Z",
      }),
      base({
        id: "44444444-4444-4444-4444-444444444444",
        rank: 90,
        timestamp: "2026-06-01T00:00:00.000Z",
      }),
    ]);
    expect(hits.map((h) => h.id)).toEqual([
      "44444444-4444-4444-4444-444444444444",
      "33333333-3333-3333-3333-333333333333",
      "22222222-2222-2222-2222-222222222222",
    ]);
  });

  it("scores exact email/phone highly", () => {
    expect(scoreExactIdentityMatch("jane@example.com", { email: "jane@example.com" })).toBe(100);
    expect(scoreExactIdentityMatch("+1 (555) 010-9999", { phone: "+1 (555) 010-9999" })).toBe(100);
    expect(scoreExactIdentityMatch("jane", { email: "jane@example.com" })).toBe(80);
  });

  it("compareSearchHits is deterministic", () => {
    const a = base({ rank: 10, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const b = base({ rank: 10, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
    expect(compareSearchHits(a, b)).toBeLessThan(0);
  });
});

describe("snippets + mapping", () => {
  it("strips angle brackets from snippets", () => {
    expect(sanitizeSearchSnippet("<script>alert(1)</script> hi")).toBe("scriptalert(1)/script hi");
    expect(
      mapSearchHit({
        type: "message",
        id: "55555555-5555-5555-5555-555555555555",
        title: "<b>t</b>",
        subtitle: null,
        snippet: "Hello <img>",
        timestamp: null,
        conversation_id: null,
        contact_id: null,
        message_id: null,
        rank: 1,
      }).snippet,
    ).toBe("Hello img");
  });
});

describe("permission-aware filtering", () => {
  it("drops notes when capability absent", () => {
    const result = emptyGlobalSearchResult({ q: "x" });
    result.groups.notes = [
      {
        type: "note",
        id: "66666666-6666-6666-6666-666666666666",
        title: "Internal note",
        subtitle: null,
        snippet: "secret",
        timestamp: null,
        conversation_id: "77777777-7777-7777-7777-777777777777",
        contact_id: null,
        message_id: null,
        rank: 50,
      },
    ];
    const filtered = filterHitsForPermissions(result, false);
    expect(filtered.groups.notes).toEqual([]);
    expect(filtered.can_search_notes).toBe(false);
  });
});

describe("keyboard helpers", () => {
  it("toggles with Cmd/Ctrl+K", () => {
    expect(
      resolveSearchKeyboardAction({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        open: false,
        hasSelection: false,
      }),
    ).toEqual({ type: "open" });
    expect(
      resolveSearchKeyboardAction({
        key: "k",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        open: true,
        hasSelection: false,
      }),
    ).toEqual({ type: "close" });
  });

  it("supports escape, arrows, enter", () => {
    expect(
      resolveSearchKeyboardAction({
        key: "Escape",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        open: true,
        hasSelection: false,
      }),
    ).toEqual({ type: "close" });
    expect(
      resolveSearchKeyboardAction({
        key: "ArrowDown",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        open: true,
        hasSelection: false,
      }),
    ).toEqual({ type: "move", delta: 1 });
    expect(
      resolveSearchKeyboardAction({
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        open: true,
        hasSelection: true,
      }),
    ).toEqual({ type: "select" });
  });

  it("clamps selection index", () => {
    expect(clampSearchIndex(-1, 3)).toBe(0);
    expect(clampSearchIndex(99, 3)).toBe(2);
    expect(clampSearchIndex(0, 0)).toBe(-1);
  });
});

describe("flattenSearchHits", () => {
  it("concatenates groups in stable order", () => {
    const result = emptyGlobalSearchResult();
    result.groups.contacts = [
      {
        type: "contact",
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title: "A",
        subtitle: null,
        snippet: null,
        timestamp: null,
        conversation_id: null,
        contact_id: null,
        message_id: null,
        rank: 1,
      },
    ];
    expect(flattenSearchHits(result.groups)).toHaveLength(1);
  });
});
