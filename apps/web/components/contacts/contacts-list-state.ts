import type { ContactListItem, ListContactsResult } from "@site-chat/shared";

export type ContactsListSnapshot = {
  items: ContactListItem[];
  nextBefore: ListContactsResult["next_before"];
  hasMore: boolean;
  /** Bumped on intentional filter replace so stale responses are ignored. */
  generation: number;
};

type CacheListener = (snapshot: ContactsListSnapshot) => void;

/** Survives ContactsList remounts (Suspense / layout refresh) for the same filter. */
const listCache = new Map<string, ContactsListSnapshot>();
const listeners = new Map<string, Set<CacheListener>>();

export function contactsListCacheKey(
  workspaceId: string,
  filterKey: string,
): string {
  return `${workspaceId}::${filterKey}`;
}

export function buildContactsFilterKey(q: string, tagId: string): string {
  return `${q}|${tagId}`;
}

export function contactsFilterHasActiveFilters(
  q: string,
  tagId: string,
): boolean {
  return Boolean(q.trim() || tagId);
}

export function readContactsListCache(
  cacheKey: string,
): ContactsListSnapshot | undefined {
  return listCache.get(cacheKey);
}

function notify(cacheKey: string, snapshot: ContactsListSnapshot): void {
  const set = listeners.get(cacheKey);
  if (!set) {
    return;
  }
  for (const listener of set) {
    listener(snapshot);
  }
}

export function writeContactsListCache(
  cacheKey: string,
  snapshot: ContactsListSnapshot,
): void {
  listCache.set(cacheKey, snapshot);
  notify(cacheKey, snapshot);
}

export function subscribeContactsListCache(
  cacheKey: string,
  listener: CacheListener,
): () => void {
  let set = listeners.get(cacheKey);
  if (!set) {
    set = new Set();
    listeners.set(cacheKey, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(cacheKey);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(cacheKey);
    }
  };
}

export function clearContactsListCache(cacheKey?: string): void {
  if (cacheKey) {
    listCache.delete(cacheKey);
    listeners.delete(cacheKey);
    return;
  }
  listCache.clear();
  listeners.clear();
}

export function bumpContactsListGeneration(cacheKey: string): number {
  const existing = listCache.get(cacheKey);
  const generation = (existing?.generation ?? 0) + 1;
  const snapshot: ContactsListSnapshot = {
    items: existing?.items ?? [],
    nextBefore: existing?.nextBefore ?? null,
    hasMore: existing?.hasMore ?? false,
    generation,
  };
  listCache.set(cacheKey, snapshot);
  return generation;
}

export function seedContactsListCache(
  cacheKey: string,
  seed: Omit<ContactsListSnapshot, "generation">,
): ContactsListSnapshot {
  const existing = listCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const snapshot: ContactsListSnapshot = { ...seed, generation: 0 };
  listCache.set(cacheKey, snapshot);
  return snapshot;
}

/** Append page-2+ rows without duplicates; preserves existing order. */
export function appendContactPage(
  current: ContactListItem[],
  page: ContactListItem[],
): ContactListItem[] {
  if (page.length === 0) {
    return current;
  }
  const seen = new Set(current.map((item) => item.id));
  const appended = page.filter((item) => !seen.has(item.id));
  if (appended.length === 0) {
    return current;
  }
  return [...current, ...appended];
}

/**
 * Apply a Load more RPC result into the cache when the filter generation and
 * keyset cursor still match. Returns the new snapshot, or null if stale.
 */
export function applyContactsLoadMoreResult(
  cacheKey: string,
  args: {
    generation: number;
    cursor: NonNullable<ListContactsResult["next_before"]>;
    result: ListContactsResult;
  },
): ContactsListSnapshot | null {
  const existing = listCache.get(cacheKey);
  if (!existing || existing.generation !== args.generation) {
    return null;
  }
  // Cursor moved (another append won) or filter replaced the page — ignore.
  if (
    !existing.nextBefore ||
    existing.nextBefore.last_seen_at !== args.cursor.last_seen_at ||
    existing.nextBefore.id !== args.cursor.id
  ) {
    return null;
  }
  const snapshot: ContactsListSnapshot = {
    items: appendContactPage(existing.items, args.result.items),
    nextBefore: args.result.next_before,
    hasMore: args.result.has_more,
    generation: existing.generation,
  };
  writeContactsListCache(cacheKey, snapshot);
  return snapshot;
}

/**
 * Replace the list for a filter fetch when generation still matches.
 */
export function applyContactsFilterResult(
  cacheKey: string,
  args: {
    generation: number;
    result: ListContactsResult;
  },
): ContactsListSnapshot | null {
  const existing = listCache.get(cacheKey);
  if (!existing || existing.generation !== args.generation) {
    return null;
  }
  const snapshot: ContactsListSnapshot = {
    items: args.result.items,
    nextBefore: args.result.next_before,
    hasMore: args.result.has_more,
    generation: existing.generation,
  };
  writeContactsListCache(cacheKey, snapshot);
  return snapshot;
}
