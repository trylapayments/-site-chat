"use client";

import { Inbox } from "lucide-react";
import type {
  ConversationListItem,
  ListConversationsQuery,
} from "@site-chat/shared";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { ConversationListItemRow } from "@/components/inbox/workspace/ConversationListItem";
import { toAppRoute } from "@/lib/auth/redirect";
import { buildPageMeta } from "@/lib/dashboard/pagination";
import { serializeDashboardListQuery } from "@/lib/dashboard/search-params";
import { parseInboxListQuery } from "@/lib/inbox/search-params";
import { useLiveInboxList } from "@/lib/realtime/use-operator-inbox";

function serializeInboxListQuery(query: ListConversationsQuery): string {
  const params = serializeDashboardListQuery({
    q: query.q,
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  });
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.assignment && query.assignment !== "all") {
    params.set("assignment", query.assignment);
  }
  return params.toString();
}

export function ConversationList({
  workspaceId,
  workspaceSlug,
  memberId,
  initialItems,
  initialTotal,
}: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  initialItems: ConversationListItem[];
  initialTotal: number;
}) {
  const params = useParams<{ conversationId?: string }>();
  const searchParams = useSearchParams();
  const selectedId =
    typeof params.conversationId === "string" ? params.conversationId : null;

  const query = useMemo(
    () => parseInboxListQuery(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );

  const hasFilters = Boolean(query.q || query.status || query.assignment);
  const listQueryString = serializeInboxListQuery(query);

  const { items, connectionState, refreshList } = useLiveInboxList({
    workspaceId,
    memberId,
    initialItems,
    query,
  });

  // Layout SSR seeds the unfiltered first page. When the URL has filters,
  // refresh immediately so the queue matches the active filter set.
  const queryKey = useMemo(
    () =>
      JSON.stringify({
        status: query.status ?? null,
        assignment: query.assignment ?? null,
        q: query.q ?? null,
        sort: query.sort ?? null,
        page: query.page,
        pageSize: query.pageSize,
      }),
    [query],
  );

  useEffect(() => {
    if (
      hasFilters ||
      query.page > 1 ||
      (query.sort && query.sort !== "-last_message_at")
    ) {
      void refreshList();
    }
  }, [hasFilters, query.page, query.sort, queryKey, refreshList]);

  const pageMeta = buildPageMeta({
    total: hasFilters ? Math.max(items.length, initialTotal) : initialTotal,
    page: query.page,
    pageSize: query.pageSize,
  });

  // Prefer live list length for the header when filters are active; the layout
  // total is only authoritative for the default unfiltered seed.
  const displayTotal = hasFilters ? items.length : initialTotal;

  return (
    <div
      className="bg-inbox-panel flex h-full min-h-0 flex-col"
      data-testid="inbox-conversation-list"
    >
      <span
        data-testid="inbox-realtime-ready"
        data-realtime-state={connectionState}
        hidden
      />

      <div className="text-inbox-muted flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px]">
        <span className="tabular-nums">
          {displayTotal} conversation{displayTotal === 1 ? "" : "s"}
        </span>
      </div>

      <ConnectionBanner
        state={connectionState}
        onRetry={() => {
          void refreshList();
        }}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="table"
        aria-label="Conversations"
      >
        <div role="rowgroup" className="sr-only">
          <div role="row">
            <span role="columnheader">Contact</span>
            <span role="columnheader">Preview</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Assignee</span>
            <span role="columnheader">Last activity</span>
          </div>
        </div>

        <div role="rowgroup">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <div className="bg-brand-soft text-brand flex size-10 items-center justify-center rounded-full">
                <Inbox className="size-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-neutral-800">
                {hasFilters
                  ? "No matching conversations"
                  : "No conversations yet"}
              </p>
              <p className="text-inbox-muted text-xs leading-relaxed">
                {hasFilters
                  ? "Try adjusting your search or filters."
                  : "Visitor messages will appear here once conversations start."}
              </p>
            </div>
          ) : (
            items.map((conversation) => (
              <ConversationListItemRow
                key={conversation.id}
                conversation={conversation}
                workspaceSlug={workspaceSlug}
                selected={selectedId === conversation.id}
                listQueryString={listQueryString}
              />
            ))
          )}
        </div>
      </div>

      {pageMeta.totalPages > 1 ? (
        <InboxListPagination
          workspaceSlug={workspaceSlug}
          pageMeta={pageMeta}
          listQueryString={listQueryString}
        />
      ) : null}
    </div>
  );
}

function InboxListPagination({
  workspaceSlug,
  pageMeta,
  listQueryString,
}: {
  workspaceSlug: string;
  pageMeta: {
    page: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  listQueryString: string;
}) {
  const params = new URLSearchParams(listQueryString);
  const base = `/app/${workspaceSlug}/inbox`;

  function hrefForPage(page: number): string {
    const next = new URLSearchParams(params);
    if (page <= 1) {
      next.delete("page");
    } else {
      next.set("page", String(page));
    }
    const qs = next.toString();
    return qs ? `${base}?${qs}` : base;
  }

  return (
    <div className="border-inbox-border flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2 text-[11px]">
      {pageMeta.hasPrev ? (
        <Link
          href={toAppRoute(hrefForPage(pageMeta.page - 1))}
          className="text-brand font-medium hover:underline"
        >
          Previous
        </Link>
      ) : (
        <span className="text-inbox-muted">Previous</span>
      )}
      <span className="text-inbox-muted tabular-nums">
        {pageMeta.page} / {pageMeta.totalPages}
      </span>
      {pageMeta.hasNext ? (
        <Link
          href={toAppRoute(hrefForPage(pageMeta.page + 1))}
          className="text-brand font-medium hover:underline"
        >
          Next
        </Link>
      ) : (
        <span className="text-inbox-muted">Next</span>
      )}
    </div>
  );
}
