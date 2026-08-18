"use client";

import {
  crmMessagesEn,
  type ContactListItem,
  type ListContactsResult,
} from "@site-chat/shared";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ContactTagChip } from "@/components/crm/ContactTagsEditor";
import { Button } from "@/components/ui/button";
import { toAppRoute } from "@/lib/auth/redirect";
import { listContactsAction } from "@/lib/crm/actions";
import { workspaceContactsPath } from "@/lib/dashboard/routes";

const messages = crmMessagesEn;

export function ContactsList({
  workspaceSlug,
  initialItems,
  initialNextBefore,
  initialHasMore,
  q,
  tagId,
}: {
  workspaceSlug: string;
  initialItems: ContactListItem[];
  initialNextBefore: ListContactsResult["next_before"];
  initialHasMore: boolean;
  q?: string;
  tagId?: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextBefore, setNextBefore] = useState(initialNextBefore);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // When search/filter props change (new server render), reset list state.
  const filterKey = `${q ?? ""}|${tagId ?? ""}|${initialItems[0]?.id ?? ""}|${String(initialItems.length)}`;
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey);
    setItems(initialItems);
    setNextBefore(initialNextBefore);
    setHasMore(initialHasMore);
    setError(null);
  }

  return (
    <div className="space-y-4">
      <ul
        className="divide-border divide-y rounded-lg border"
        data-testid="contacts-list"
      >
        {items.map((contact) => {
          const label =
            contact.name?.trim() ||
            contact.email?.trim() ||
            contact.public_id ||
            "Unknown contact";
          return (
            <li key={contact.id}>
              <Link
                href={toAppRoute(
                  workspaceContactsPath(workspaceSlug, contact.id),
                )}
                className="hover:bg-muted/40 focus-visible:ring-ring flex flex-col gap-2 px-4 py-3 transition-colors focus-visible:ring-1 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-muted-foreground text-xs">
                    {[contact.email, contact.job_title, contact.company?.name]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.slice(0, 4).map((tagItem) => (
                    <ContactTagChip key={tagItem.id} tag={tagItem} />
                  ))}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {hasMore ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="contacts-load-more"
          disabled={isPending || !nextBefore}
          onClick={() => {
            if (!nextBefore) {
              return;
            }
            setError(null);
            startTransition(async () => {
              const result = await listContactsAction(workspaceSlug, {
                limit: 50,
                q: q?.trim() || undefined,
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
          {isPending ? messages.contactsLoadingMore : messages.contactsLoadMore}
        </Button>
      ) : null}
    </div>
  );
}
