import { beforeEach, describe, expect, it } from "vitest";

import {
  appendContactPage,
  applyContactsFilterResult,
  applyContactsLoadMoreResult,
  buildContactsFilterKey,
  bumpContactsListGeneration,
  clearContactsListCache,
  contactsListCacheKey,
  readContactsListCache,
  seedContactsListCache,
  subscribeContactsListCache,
} from "@/components/contacts/contacts-list-state";
import type { ContactListItem, ListContactsResult } from "@site-chat/shared";

function contact(id: string, lastSeenAt: string): ContactListItem {
  const hex = id.replaceAll("-", "");
  return {
    id,
    public_id: `vis_${hex}`,
    name: `Contact ${id}`,
    email: `${id}@example.com`,
    phone: null,
    job_title: null,
    locale: null,
    country_code: null,
    company: null,
    tags: [],
    first_seen_at: lastSeenAt,
    last_seen_at: lastSeenAt,
    visit_count: 1,
    updated_at: lastSeenAt,
  };
}

function page(
  items: ContactListItem[],
  next: ListContactsResult["next_before"],
  hasMore: boolean,
): ListContactsResult {
  return { items, next_before: next, has_more: hasMore };
}

describe("contacts-list-state", () => {
  beforeEach(() => {
    clearContactsListCache();
  });

  it("builds filter keys", () => {
    expect(buildContactsFilterKey("", "")).toBe("|");
    expect(buildContactsFilterKey("ada", "tag-1")).toBe("ada|tag-1");
  });

  it("appends without duplicates and preserves order", () => {
    const first = [
      contact(
        "00000000-0000-4000-8000-000000000001",
        "2026-01-02T00:00:00.000Z",
      ),
      contact(
        "00000000-0000-4000-8000-000000000002",
        "2026-01-01T00:00:00.000Z",
      ),
    ];
    const second = [
      contact(
        "00000000-0000-4000-8000-000000000002",
        "2026-01-01T00:00:00.000Z",
      ),
      contact(
        "00000000-0000-4000-8000-000000000003",
        "2025-12-31T00:00:00.000Z",
      ),
    ];
    const merged = appendContactPage(first, second);
    expect(merged.map((row) => row.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  it("keeps Load more results after remount via module cache", () => {
    const key = contactsListCacheKey("ws-1", "|");
    const cursor = {
      last_seen_at: "2026-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000002",
    };
    seedContactsListCache(key, {
      items: [
        contact(
          "00000000-0000-4000-8000-000000000001",
          "2026-01-02T00:00:00.000Z",
        ),
        contact(
          "00000000-0000-4000-8000-000000000002",
          "2026-01-01T00:00:00.000Z",
        ),
      ],
      nextBefore: cursor,
      hasMore: true,
    });

    const applied = applyContactsLoadMoreResult(key, {
      generation: 0,
      cursor,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000003",
            "2025-12-31T00:00:00.000Z",
          ),
        ],
        null,
        false,
      ),
    });
    expect(applied?.items).toHaveLength(3);
    expect(readContactsListCache(key)?.items).toHaveLength(3);
  });

  it("ignores stale Load more when generation bumped (filter reset)", () => {
    const key = contactsListCacheKey("ws-1", "|");
    const cursor = {
      last_seen_at: "2026-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
    };
    seedContactsListCache(key, {
      items: [
        contact(
          "00000000-0000-4000-8000-000000000001",
          "2026-01-01T00:00:00.000Z",
        ),
      ],
      nextBefore: cursor,
      hasMore: true,
    });
    const generation = bumpContactsListGeneration(key);
    expect(generation).toBe(1);

    const stale = applyContactsLoadMoreResult(key, {
      generation: 0,
      cursor,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000099",
            "2025-01-01T00:00:00.000Z",
          ),
        ],
        null,
        false,
      ),
    });
    expect(stale).toBeNull();
    expect(readContactsListCache(key)?.items).toHaveLength(1);
  });

  it("ignores duplicate Load more for an already-advanced cursor", () => {
    const key = contactsListCacheKey("ws-1", "|");
    const cursor1 = {
      last_seen_at: "2026-01-02T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
    };
    const cursor2 = {
      last_seen_at: "2026-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000002",
    };
    seedContactsListCache(key, {
      items: [
        contact(
          "00000000-0000-4000-8000-000000000001",
          "2026-01-02T00:00:00.000Z",
        ),
      ],
      nextBefore: cursor1,
      hasMore: true,
    });
    applyContactsLoadMoreResult(key, {
      generation: 0,
      cursor: cursor1,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000002",
            "2026-01-01T00:00:00.000Z",
          ),
        ],
        cursor2,
        true,
      ),
    });
    const duplicate = applyContactsLoadMoreResult(key, {
      generation: 0,
      cursor: cursor1,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000002",
            "2026-01-01T00:00:00.000Z",
          ),
        ],
        cursor2,
        true,
      ),
    });
    expect(duplicate).toBeNull();
    expect(readContactsListCache(key)?.items).toHaveLength(2);
  });

  it("replaces list on filter result and notifies subscribers", () => {
    const key = contactsListCacheKey("ws-1", "ada|");
    seedContactsListCache(key, {
      items: [],
      nextBefore: null,
      hasMore: false,
    });
    const generation = bumpContactsListGeneration(key);
    const seen: number[] = [];
    const unsubscribe = subscribeContactsListCache(key, (snap) => {
      seen.push(snap.items.length);
    });

    applyContactsFilterResult(key, {
      generation,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000010",
            "2026-01-02T00:00:00.000Z",
          ),
        ],
        null,
        false,
      ),
    });
    unsubscribe();
    expect(seen).toEqual([1]);
  });

  it("ignores stale filter responses after a newer generation", () => {
    const key = contactsListCacheKey("ws-1", "ada|");
    seedContactsListCache(key, {
      items: [],
      nextBefore: null,
      hasMore: false,
    });
    bumpContactsListGeneration(key);
    const newer = bumpContactsListGeneration(key);
    applyContactsFilterResult(key, {
      generation: newer,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000011",
            "2026-01-02T00:00:00.000Z",
          ),
        ],
        null,
        false,
      ),
    });
    const stale = applyContactsFilterResult(key, {
      generation: newer - 1,
      result: page(
        [
          contact(
            "00000000-0000-4000-8000-000000000012",
            "2026-01-01T00:00:00.000Z",
          ),
        ],
        null,
        false,
      ),
    });
    expect(stale).toBeNull();
    expect(readContactsListCache(key)?.items[0]?.id).toBe(
      "00000000-0000-4000-8000-000000000011",
    );
  });
});
