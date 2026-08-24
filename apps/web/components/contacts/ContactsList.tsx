"use client";

import {
  crmMessagesEn,
  type ContactListItem,
  type ListContactsQuery,
  type ListContactsResult,
} from "@site-chat/shared";
import Link from "next/link";
import type { Route } from "next";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  contactDisplayLabel,
  contactLocationLabel,
  formatContactListTime,
  initialsFromLabel,
} from "@/components/contacts/contact-display";
import {
  applyContactsFilterResult,
  applyContactsLoadMoreResult,
  buildContactsFilterKey,
  bumpContactsListGeneration,
  clearContactsListCache,
  contactsFilterHasActiveFilters,
  contactsListCacheKey,
  readContactsListCache,
  seedContactsListCache,
  subscribeContactsListCache,
  type ContactsListSnapshot,
} from "@/components/contacts/contacts-list-state";
import { ContactTagChip } from "@/components/crm/ContactTagsEditor";
import { Button } from "@/components/ui/button";
import { toAppRoute } from "@/lib/auth/redirect";
import { fetchContacts } from "@/lib/crm/queries";
import { workspaceContactsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/client";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const messages = crmMessagesEn;

function buildListHref(
  workspaceSlug: string,
  contactId: string,
  q: string | null,
  tag: string | null,
): Route {
  const params = new URLSearchParams();
  if (q?.trim()) {
    params.set("q", q.trim());
  }
  if (tag) {
    params.set("tag", tag);
  }
  const qs = params.toString();
  const path = workspaceContactsPath(workspaceSlug, contactId);
  return toAppRoute(qs ? `${path}?${qs}` : path);
}

async function loadContactsPage(
  workspaceId: string,
  query: ListContactsQuery,
): Promise<ListContactsResult> {
  // Browser RPC (not a Server Action) so Load more / filter refresh cannot
  // trigger App Router refresh that remounts the contacts layout list.
  const supabase = createClient() as AppSupabaseClient;
  return fetchContacts(supabase, workspaceId, query);
}

function snapshotToState(snapshot: ContactsListSnapshot): {
  items: ContactListItem[];
  nextBefore: ListContactsResult["next_before"];
  hasMore: boolean;
} {
  return {
    items: snapshot.items,
    nextBefore: snapshot.nextBefore,
    hasMore: snapshot.hasMore,
  };
}

export function ContactsList({
  workspaceId,
  workspaceSlug,
  initialItems,
  initialNextBefore,
  initialHasMore,
}: {
  workspaceId: string;
  workspaceSlug: string;
  initialItems: ContactListItem[];
  initialNextBefore: ListContactsResult["next_before"];
  initialHasMore: boolean;
}) {
  const params = useParams<{ contactId?: string }>();
  const searchParams = useSearchParams();
  const selectedId =
    typeof params.contactId === "string" ? params.contactId : null;
  const q = searchParams.get("q") ?? "";
  const tagId = searchParams.get("tag") ?? "";
  const filterKey = buildContactsFilterKey(q, tagId);
  const cacheKey = contactsListCacheKey(workspaceId, filterKey);

  const [items, setItems] = useState<ContactListItem[]>(() => {
    const existing = readContactsListCache(cacheKey);
    if (existing) {
      return existing.items;
    }
    // Layout SSR seeds the unfiltered first page only — never write that into
    // a filtered cache key or search would flash stale unfiltered rows.
    if (!contactsFilterHasActiveFilters(q, tagId)) {
      return seedContactsListCache(cacheKey, {
        items: initialItems,
        nextBefore: initialNextBefore,
        hasMore: initialHasMore,
      }).items;
    }
    return [];
  });
  const [nextBefore, setNextBefore] = useState(() => {
    const existing = readContactsListCache(cacheKey);
    if (existing) {
      return existing.nextBefore;
    }
    return contactsFilterHasActiveFilters(q, tagId) ? null : initialNextBefore;
  });
  const [hasMore, setHasMore] = useState(() => {
    const existing = readContactsListCache(cacheKey);
    if (existing) {
      return existing.hasMore;
    }
    return contactsFilterHasActiveFilters(q, tagId) ? false : initialHasMore;
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** Absolute times until mounted — avoids hydration #418 from Date.now(). */
  const [nowMs, setNowMs] = useState<number | undefined>(undefined);

  /** Last filter this instance committed; remount starts null and re-syncs. */
  const committedFilterKeyRef = useRef<string | null>(null);
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const nextBeforeRef = useRef(nextBefore);
  nextBeforeRef.current = nextBefore;
  const isPendingRef = useRef(isPending);
  isPendingRef.current = isPending;
  const isRefreshingRef = useRef(isRefreshing);
  isRefreshingRef.current = isRefreshing;

  const applyLocalSnapshot = (snapshot: ContactsListSnapshot) => {
    const next = snapshotToState(snapshot);
    setItems(next.items);
    setNextBefore(next.nextBefore);
    setHasMore(next.hasMore);
  };

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  // Stay in sync when Load more / filter RPC completes after a remount.
  useEffect(() => {
    return subscribeContactsListCache(cacheKey, (snapshot) => {
      applyLocalSnapshot(snapshot);
      setIsPending(false);
      setIsRefreshing(false);
    });
  }, [cacheKey]);

  // Own list resets when filters change. Same filter + remount must NOT refetch
  // or clobber Load more progress (module cache + subscription own the data).
  useEffect(() => {
    const hasFilters = contactsFilterHasActiveFilters(q, tagId);

    if (committedFilterKeyRef.current === filterKey) {
      return;
    }

    const previousFilter = committedFilterKeyRef.current;
    committedFilterKeyRef.current = filterKey;

    const cached = readContactsListCache(cacheKey);
    if (cached) {
      applyLocalSnapshot(cached);
    }

    // New component instance: trust module cache / unfiltered SSR seed.
    // Do not refetch — that race is what wiped Load more back to 50.
    if (previousFilter === null) {
      if (cached) {
        return;
      }
      if (!hasFilters) {
        seedContactsListCache(cacheKey, {
          items: initialItems,
          nextBefore: initialNextBefore,
          hasMore: initialHasMore,
        });
        return;
      }
      // Filtered URL with no cache yet — fall through to fetch.
    }

    // Intentional filter change: drop the previous filter's cache entry.
    if (previousFilter !== null && previousFilter !== filterKey) {
      clearContactsListCache(contactsListCacheKey(workspaceId, previousFilter));
    }

    // Ensure this filter key has a cache row, then bump generation so any
    // in-flight Load more for a prior generation cannot append.
    seedContactsListCache(cacheKey, {
      items: [],
      nextBefore: null,
      hasMore: false,
    });
    const generation = bumpContactsListGeneration(cacheKey);
    const pending = readContactsListCache(cacheKey);
    if (pending) {
      applyLocalSnapshot(pending);
    }

    setIsRefreshing(true);
    setError(null);
    setIsPending(false);

    void (async () => {
      try {
        const result = await loadContactsPage(workspaceId, {
          limit: 50,
          q: q.trim() || undefined,
          tag_ids: tagId ? [tagId] : undefined,
        });
        const applied = applyContactsFilterResult(cacheKey, {
          generation,
          result,
        });
        if (!applied) {
          return;
        }
        // Subscription updates React state; also apply locally for snappiness.
        applyLocalSnapshot(applied);
      } catch {
        const current = readContactsListCache(cacheKey);
        if (current?.generation === generation) {
          setError(messages.contactsError);
        }
      } finally {
        const current = readContactsListCache(cacheKey);
        if (current?.generation === generation) {
          setIsRefreshing(false);
        }
      }
    })();
  }, [
    filterKey,
    workspaceId,
    q,
    tagId,
    cacheKey,
    initialItems,
    initialNextBefore,
    initialHasMore,
  ]);

  const handleLoadMore = () => {
    const cursor = nextBeforeRef.current;
    if (!cursor || isPendingRef.current || isRefreshingRef.current) {
      return;
    }

    const activeCacheKey = cacheKeyRef.current;
    const snapshot = readContactsListCache(activeCacheKey);
    if (!snapshot?.nextBefore) {
      return;
    }
    const generation = snapshot.generation;
    const requestedFilterKey = filterKeyRef.current;

    setError(null);
    setIsPending(true);

    void (async () => {
      try {
        const result = await loadContactsPage(workspaceId, {
          limit: 50,
          q: q.trim() || undefined,
          tag_ids: tagId ? [tagId] : undefined,
          before: cursor,
        });
        if (filterKeyRef.current !== requestedFilterKey) {
          return;
        }
        const applied = applyContactsLoadMoreResult(activeCacheKey, {
          generation,
          cursor,
          result,
        });
        if (!applied) {
          return;
        }
        applyLocalSnapshot(applied);
      } catch {
        if (filterKeyRef.current === requestedFilterKey) {
          const current = readContactsListCache(activeCacheKey);
          if (current?.generation === generation) {
            setError(messages.contactsError);
          }
        }
      } finally {
        if (filterKeyRef.current === requestedFilterKey) {
          const current = readContactsListCache(activeCacheKey);
          if (current?.generation === generation) {
            setIsPending(false);
          }
        }
      }
    })();
  };

  return (
    <div
      className="bg-inbox-panel flex h-full min-h-0 flex-col"
      data-testid="contacts-list"
      role="table"
      aria-label="Contacts"
      aria-busy={isRefreshing || isPending}
    >
      <div className="text-inbox-muted flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px]">
        <span className="tabular-nums">
          {items.length}
          {hasMore ? "+" : ""} contact{items.length === 1 ? "" : "s"}
        </span>
        {isRefreshing ? <span>Searching…</span> : null}
      </div>

      <div
        className="border-inbox-border/70 text-inbox-muted hidden shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_72px] gap-3 border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase 2xl:grid"
        role="row"
      >
        <span role="columnheader">Customer</span>
        <span role="columnheader">Email</span>
        <span role="columnheader">Company</span>
        <span role="columnheader">Location</span>
        <span role="columnheader" className="text-right">
          Last seen
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="rowgroup">
        {error ? (
          <p className="text-destructive px-4 py-6 text-sm">{error}</p>
        ) : null}

        {!error && items.length === 0 && !isRefreshing ? (
          <div className="flex h-full min-h-[12rem] flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium text-neutral-900">
              {q || tagId
                ? messages.contactsSearchEmpty
                : messages.contactsEmpty}
            </p>
            <p className="text-inbox-muted mt-1.5 max-w-xs text-[13px] leading-relaxed">
              {q || tagId
                ? "Try a different name, email, or tag."
                : "Contacts appear when visitors identify themselves during chat."}
            </p>
          </div>
        ) : null}

        {items.map((contact) => {
          const label = contactDisplayLabel(contact);
          const selected = selectedId === contact.id;
          const location = contactLocationLabel(contact);
          const secondary =
            contact.job_title?.trim() ||
            contact.public_id ||
            contact.phone ||
            null;
          const href = buildListHref(workspaceSlug, contact.id, q, tagId);

          return (
            <div
              key={contact.id}
              role="row"
              data-contact-id={contact.id}
              data-selected={selected ? "true" : "false"}
              className={cn(
                "group relative border-inbox-border/50 border-b transition-colors last:border-b-0",
                selected
                  ? "bg-brand-soft"
                  : "hover:bg-inbox-hover bg-transparent",
              )}
            >
              {selected ? (
                <span
                  className="bg-brand absolute inset-y-2 left-0 w-0.5 rounded-full"
                  aria-hidden="true"
                />
              ) : null}
              <Link
                href={href}
                className="grid grid-cols-1 gap-2 px-4 py-3 outline-none focus-visible:bg-brand-soft 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_72px] 2xl:items-center 2xl:gap-3"
                aria-current={selected ? "page" : undefined}
              >
                <div role="cell" className="flex min-w-0 items-start gap-3">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200/80 text-[11px] font-semibold text-neutral-600"
                    aria-hidden="true"
                  >
                    {initialsFromLabel(label)}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-[14px] leading-snug",
                        selected
                          ? "font-semibold text-neutral-950"
                          : "font-medium text-neutral-800",
                      )}
                    >
                      {label}
                    </p>
                    {secondary ? (
                      <p className="text-inbox-muted mt-0.5 truncate text-[12px]">
                        {secondary}
                      </p>
                    ) : null}
                    {contact.tags.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1 2xl:hidden">
                        {contact.tags.slice(0, 3).map((tagItem) => (
                          <ContactTagChip key={tagItem.id} tag={tagItem} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  role="cell"
                  className="text-inbox-muted hidden min-w-0 truncate text-[13px] 2xl:block"
                >
                  {contact.email?.trim() || "—"}
                </div>
                <div
                  role="cell"
                  className="text-inbox-muted hidden min-w-0 truncate text-[13px] 2xl:block"
                >
                  {contact.company?.name.trim() || "—"}
                </div>
                <div
                  role="cell"
                  className="text-inbox-muted hidden min-w-0 truncate text-[13px] 2xl:block"
                >
                  {location || "—"}
                </div>
                <div
                  role="cell"
                  className="text-inbox-muted hidden text-right text-[12px] tabular-nums 2xl:block"
                >
                  {formatContactListTime(contact.last_seen_at, nowMs)}
                </div>

                <div className="text-inbox-muted flex items-center justify-between gap-3 text-[12px] 2xl:hidden">
                  <span className="min-w-0 truncate">
                    {[contact.email, contact.company?.name, location]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <time className="shrink-0 tabular-nums">
                    {formatContactListTime(contact.last_seen_at, nowMs)}
                  </time>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {hasMore ? (
        <div className="border-inbox-border shrink-0 border-t px-3 py-2.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="contacts-load-more"
            className="border-inbox-border h-8 w-full text-[13px]"
            disabled={isPending || isRefreshing || !nextBefore}
            onClick={handleLoadMore}
          >
            {isPending
              ? messages.contactsLoadingMore
              : messages.contactsLoadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
