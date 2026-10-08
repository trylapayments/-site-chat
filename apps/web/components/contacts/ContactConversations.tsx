"use client";

import { crmMessagesEn, type ConversationListItem } from "@site-chat/shared";
import { MessageSquareText } from "lucide-react";
import Link from "next/link";

import { formatContactListTime } from "@/components/contacts/contact-display";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import { cn } from "@/lib/utils";

const messages = crmMessagesEn;

function StatusPill({ status }: { status: ConversationListItem["status"] }) {
  if (status === "open") {
    return (
      <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
        open
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize",
        status === "pending" && "bg-amber-100 text-amber-800",
        status === "resolved" && "bg-sky-100 text-sky-800",
        status === "closed" && "bg-neutral-100 text-neutral-500",
      )}
    >
      {status}
    </span>
  );
}

/**
 * Recent conversations for a contact, sourced from existing list_conversations
 * search (email/name) and filtered to this contact id — no fabricated data.
 */
export function ContactConversations({
  workspaceSlug,
  conversationCount,
  conversations,
  searchHint,
  compact = false,
}: {
  workspaceSlug: string;
  conversationCount: number;
  conversations: ConversationListItem[];
  /** Email or name used to deep-link into Inbox search. */
  searchHint: string | null;
  /** When true, omit the section title (parent Section provides it). */
  compact?: boolean;
}) {
  const inboxHref = toAppRoute(
    searchHint
      ? `${workspaceNavPath(workspaceSlug, "inbox")}?q=${encodeURIComponent(searchHint)}`
      : workspaceNavPath(workspaceSlug, "inbox"),
  );

  return (
    <div className="space-y-3" data-testid="contact-conversations">
      <div className="flex items-center justify-between gap-3">
        {compact ? (
          <p className="text-inbox-muted text-[12px] tabular-nums">
            {conversationCount} {messages.conversationCount}
          </p>
        ) : (
          <div>
            <h2 className="text-[13px] font-semibold tracking-tight text-neutral-900">
              {messages.sectionConversations}
            </h2>
            <p className="text-inbox-muted mt-0.5 text-[12px] tabular-nums">
              {conversationCount} {messages.conversationCount}
            </p>
          </div>
        )}
        <Link
          href={inboxHref}
          className="text-brand text-[12.5px] font-medium hover:underline"
        >
          {messages.openInbox}
        </Link>
      </div>

      {conversations.length === 0 ? (
        <p className="text-inbox-muted text-[13px]">
          No recent conversations found for this contact.
        </p>
      ) : (
        <ul className="divide-inbox-border/70 border-inbox-border divide-y rounded-lg border">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={toAppRoute(
                  `${workspaceNavPath(workspaceSlug, "inbox")}/${conversation.id}`,
                )}
                className="hover:bg-inbox-hover focus-visible:bg-brand-soft flex items-start gap-3 px-3 py-2.5 outline-none transition-colors"
                data-testid="contact-conversation-link"
                data-conversation-id={conversation.id}
              >
                <div className="bg-brand-soft text-brand mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <MessageSquareText
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-neutral-900">
                      {conversation.last_message_preview?.trim() ||
                        "No messages yet"}
                    </p>
                    <time className="text-inbox-muted shrink-0 text-[11px] tabular-nums">
                      {formatContactListTime(conversation.last_message_at)}
                    </time>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <StatusPill status={conversation.status} />
                    <span className="text-inbox-muted truncate text-[12px]">
                      {conversation.assigned_to?.display_label ?? "Unassigned"}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
