"use client";

import {
  crmMessagesEn,
  type ContactListItem,
  type ListContactsResult,
} from "@site-chat/shared";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  contactDisplayLabel,
  contactLocationLabel,
  formatContactListTime,
  initialsFromLabel,
} from "@/components/contacts/contact-display";
import { ContactTagChip } from "@/components/crm/ContactTagsEditor";
import { Button } from "@/components/ui/button";
import { toAppRoute } from "@/lib/auth/redirect";
import { listContactsAction } from "@/lib/crm/actions";
import { workspaceContactsPath } from "@/lib/dashboard/routes";
import { cn } from "@/lib/utils";

const messages = crmMessagesEn;

function buildListHref(
  workspaceSlug: string,
  contactId: string,
  q: string | null,
  tag: string | null,
): string {
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

export function ContactsList({
  workspaceSlug,
  initialItems,
  initialNextBefore,
  initialHasMore,
}: {
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

  const [items, setItems] = useState(initialItems);
  const [nextBefore, setNextBefore] = useState(initialNextBefore);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const filterKey = `${q}|${tagId}`;
  const skipInitialUnfilteredFetch = useRef(!(q.trim() || tagId));

  // Layout SSR seeds the unfiltered first page. Refetch when filters change
  // (or when filters clear) without wiping Load-more progress on parent re-renders.
  useEffect(() => {
    const controller = { cancelled: false };
    const hasFilters = Boolean(q.trim() || tagId);

    if (skipInitialUnfilteredFetch.current && !hasFilters) {
      skipInitialUnfilteredFetch.current = false;
      return;
    }
    skipInitialUnfilteredFetch.current = false;

    setIsRefreshing(true);
    setError(null);
    void (async () => {
      const result = await listContactsAction(workspaceSlug, {
        limit: 50,
        q: q.trim() || undefined,
        tag_ids: tagId ? [tagId] : undefined,
      });
      if (controller.cancelled) {
        return;
      }
      if (!result.success) {
        setError(result.message);
        setIsRefreshing(false);
        return;
      }
      setItems(result.data.items);
      setNextBefore(result.data.next_before);
      setHasMore(result.data.has_more);
      setIsRefreshing(false);
    })();

    return () => {
      controller.cancelled = true;
    };
  }, [filterKey, workspaceSlug, q, tagId]);

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
        className="border-inbox-border/70 text-inbox-muted hidden shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_72px] gap-3 border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase xl:grid"
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
                className="grid grid-cols-1 gap-2 px-4 py-3 outline-none focus-visible:bg-brand-soft xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_72px] xl:items-center xl:gap-3"
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
                      <div className="mt-1.5 flex flex-wrap gap-1 xl:hidden">
                        {contact.tags.slice(0, 3).map((tagItem) => (
                          <ContactTagChip key={tagItem.id} tag={tagItem} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  role="cell"
                  className="text-inbox-muted hidden min-w-0 truncate text-[13px] xl:block"
                >
                  {contact.email?.trim() || "—"}
                </div>
                <div
                  role="cell"
                  className="text-inbox-muted hidden min-w-0 truncate text-[13px] xl:block"
                >
                  {contact.company?.name.trim() || "—"}
                </div>
                <div
                  role="cell"
                  className="text-inbox-muted hidden min-w-0 truncate text-[13px] xl:block"
                >
                  {location || "—"}
                </div>
                <div
                  role="cell"
                  className="text-inbox-muted hidden text-right text-[12px] tabular-nums xl:block"
                >
                  {formatContactListTime(contact.last_seen_at)}
                </div>

                <div className="text-inbox-muted flex items-center justify-between gap-3 text-[12px] xl:hidden">
                  <span className="min-w-0 truncate">
                    {[contact.email, contact.company?.name, location]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <time className="shrink-0 tabular-nums">
                    {formatContactListTime(contact.last_seen_at)}
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
            onClick={() => {
              if (!nextBefore) {
                return;
              }
              setError(null);
              startTransition(async () => {
                const result = await listContactsAction(workspaceSlug, {
                  limit: 50,
                  q: q.trim() || undefined,
                  tag_ids: tagId ? [tagId] : undefined,
                  before: nextBefore,
                });
                if (!result.success) {
                  setError(result.message);
                  return;
                }
                setItems((current) => {
                  const seen = new Set(current.map((item) => item.id));
                  const appended = result.data.items.filter(
                    (item) => !seen.has(item.id),
                  );
                  return [...current, ...appended];
                });
                setNextBefore(result.data.next_before);
                setHasMore(result.data.has_more);
              });
            }}
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
