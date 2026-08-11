"use client";

import {
  customerTimelineEventSchema,
  customerTimelineMessagesEn,
  formatTimelineEventDescription,
  mergeTimelineEvents,
  reconcileTimelineRealtimeInsert,
  type CustomerTimelineEvent,
  type CustomerTimelineCursor,
} from "@site-chat/shared";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { listCustomerTimelineAction } from "@/lib/inbox/actions";
import { subscribeOperatorCustomerTimeline } from "@/lib/realtime/operator-subscriptions";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceNavPath } from "@/lib/dashboard/routes";

const messages = customerTimelineMessagesEn;

function formatTimelineTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function eventIconLabel(
  eventType: CustomerTimelineEvent["event_type"],
): string {
  switch (eventType) {
    case "page_viewed":
      return "Page";
    case "conversation_started":
      return "Chat";
    case "visitor_message_sent":
    case "operator_message_sent":
      return "Msg";
    case "attachment_uploaded":
      return "File";
    case "visitor_identified":
    case "visitor_profile_updated":
      return "ID";
    case "conversation_status_changed":
      return "Status";
    case "conversation_assigned":
      return "Assign";
    default:
      return "Event";
  }
}

function mapRealtimeRow(
  raw: Record<string, unknown>,
): CustomerTimelineEvent | null {
  const parsed = customerTimelineEventSchema.safeParse({
    id: raw.id,
    workspace_id: raw.workspace_id,
    contact_id: raw.contact_id,
    visitor_session_id: raw.visitor_session_id ?? null,
    conversation_id: raw.conversation_id ?? null,
    event_type: raw.event_type,
    actor_type: raw.actor_type,
    actor_member_id: raw.actor_member_id ?? null,
    metadata_json: raw.metadata_json ?? { v: 1 },
    occurred_at: raw.occurred_at,
    created_at: raw.created_at,
    dedupe_key: raw.dedupe_key ?? null,
  });
  return parsed.success ? parsed.data : null;
}

export function CustomerTimeline({
  workspaceId,
  workspaceSlug,
  contactId,
  conversationId,
}: {
  workspaceId: string;
  workspaceSlug: string;
  contactId: string;
  conversationId?: string | null;
}) {
  const [events, setEvents] = useState<CustomerTimelineEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<CustomerTimelineCursor | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInitial = () => {
    startTransition(async () => {
      setError(null);
      const result = await listCustomerTimelineAction(workspaceSlug, {
        contact_id: contactId,
        limit: 20,
      });
      if (!result.success) {
        setError(result.message);
        setLoaded(true);
        return;
      }
      setEvents(result.data.events);
      setNextBefore(result.data.next_before);
      setHasMore(result.data.has_more);
      setLoaded(true);
    });
  };

  useEffect(() => {
    setLoaded(false);
    setEvents([]);
    setNextBefore(null);
    setHasMore(false);
    setError(null);
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when contact changes
  }, [workspaceSlug, contactId]);

  useEffect(() => {
    const scheduleCatchUp = () => {
      if (catchUpTimerRef.current) {
        return;
      }
      catchUpTimerRef.current = setTimeout(() => {
        catchUpTimerRef.current = null;
        void (async () => {
          const result = await listCustomerTimelineAction(workspaceSlug, {
            contact_id: contactId,
            limit: 20,
          });
          if (!result.success) {
            return;
          }
          setEvents((prev) => mergeTimelineEvents(prev, result.data.events));
          // Keep existing pagination cursor if we already loaded older pages;
          // only refresh has_more/next when still on the first page window.
          setHasMore((prevHasMore) => prevHasMore || result.data.has_more);
          setNextBefore((prev) => prev ?? result.data.next_before);
        })();
      }, 250);
    };

    const unsubscribe = subscribeOperatorCustomerTimeline({
      workspaceId,
      contactId,
      onInsert: (payload) => {
        const row = mapRealtimeRow(payload);
        if (!row) {
          return;
        }
        setEvents((prev) =>
          reconcileTimelineRealtimeInsert(prev, row, contactId),
        );
      },
      onConnectionChange: (status) => {
        if (status === "connected") {
          scheduleCatchUp();
        }
      },
    });

    return () => {
      unsubscribe();
      if (catchUpTimerRef.current) {
        clearTimeout(catchUpTimerRef.current);
        catchUpTimerRef.current = null;
      }
    };
  }, [workspaceId, workspaceSlug, contactId]);

  const loadOlder = () => {
    if (!nextBefore || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    setError(null);
    void (async () => {
      const result = await listCustomerTimelineAction(workspaceSlug, {
        contact_id: contactId,
        limit: 20,
        before: nextBefore,
      });
      setLoadingOlder(false);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setEvents((prev) => mergeTimelineEvents(prev, result.data.events));
      setNextBefore(result.data.next_before);
      setHasMore(result.data.has_more);
    })();
  };

  return (
    <section
      className="space-y-3"
      aria-labelledby="customer-timeline-heading"
      data-testid="customer-timeline"
    >
      <h2 id="customer-timeline-heading" className="text-sm font-semibold">
        {messages.sectionTitle}
      </h2>

      {!loaded || (isPending && events.length === 0) ? (
        <p className="text-muted-foreground text-sm" role="status">
          {messages.loading}
        </p>
      ) : null}

      {error ? (
        <div className="space-y-2" role="alert">
          <p className="text-destructive text-sm">{messages.error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={loadInitial}
          >
            {messages.retry}
          </Button>
        </div>
      ) : null}

      {loaded && !error && events.length === 0 ? (
        <p className="text-muted-foreground text-sm">{messages.empty}</p>
      ) : null}

      {events.length > 0 ? (
        <ol className="space-y-3" aria-live="polite">
          {events.map((event) => {
            const description = formatTimelineEventDescription(event, messages);
            const metaUrl =
              event.event_type === "page_viewed" &&
              typeof event.metadata_json.url === "string"
                ? event.metadata_json.url
                : null;
            const showConversationLink =
              Boolean(event.conversation_id) &&
              event.conversation_id !== conversationId &&
              (event.event_type === "conversation_started" ||
                event.event_type === "visitor_message_sent" ||
                event.event_type === "operator_message_sent" ||
                event.event_type === "attachment_uploaded");

            return (
              <li
                key={event.id}
                className="space-y-0.5"
                data-testid="customer-timeline-event"
                data-event-type={event.event_type}
                data-event-id={event.id}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="bg-muted text-muted-foreground mt-0.5 inline-flex h-5 min-w-10 items-center justify-center rounded px-1 text-[10px] font-medium tracking-wide uppercase"
                    aria-hidden="true"
                  >
                    {eventIconLabel(event.event_type)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm">{description}</p>
                    {metaUrl ? (
                      <p className="text-muted-foreground break-all text-xs">
                        {metaUrl}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground text-xs">
                      <time dateTime={event.occurred_at}>
                        {formatTimelineTimestamp(event.occurred_at)}
                      </time>
                    </p>
                    {showConversationLink && event.conversation_id ? (
                      <p>
                        <Link
                          href={toAppRoute(
                            `${workspaceNavPath(workspaceSlug, "inbox")}/${event.conversation_id}`,
                          )}
                          className="text-xs underline underline-offset-2"
                        >
                          {messages.openConversation}
                        </Link>
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {hasMore && nextBefore ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loadingOlder}
          onClick={loadOlder}
          data-testid="customer-timeline-load-older"
        >
          {loadingOlder ? messages.loadingOlder : messages.loadOlder}
        </Button>
      ) : null}
    </section>
  );
}
