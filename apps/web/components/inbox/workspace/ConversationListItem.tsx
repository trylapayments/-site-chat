"use client";

import type { ConversationListItem } from "@site-chat/shared";
import { Paperclip } from "lucide-react";
import Link from "next/link";

import { toAppRoute } from "@/lib/auth/redirect";
import {
  formatConversationContactLabel,
  formatRelativeTime,
} from "@/lib/inbox/search-params";
import { cn } from "@/lib/utils";

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0] ?? "";
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  const second = parts[1] ?? "";
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

function StatusPill({ status }: { status: ConversationListItem["status"] }) {
  if (status === "open") {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
        status === "pending" && "bg-amber-100 text-amber-800",
        status === "resolved" && "bg-sky-100 text-sky-800",
        status === "closed" && "bg-neutral-100 text-neutral-500",
      )}
    >
      {status}
    </span>
  );
}

export function ConversationListItemRow({
  conversation,
  workspaceSlug,
  selected,
  listQueryString,
}: {
  conversation: ConversationListItem;
  workspaceSlug: string;
  selected: boolean;
  listQueryString: string;
}) {
  const label = formatConversationContactLabel(conversation.contact);
  const href = toAppRoute(
    listQueryString
      ? `/app/${workspaceSlug}/inbox/${conversation.id}?${listQueryString}`
      : `/app/${workspaceSlug}/inbox/${conversation.id}`,
  );
  const unread = conversation.unread_count > 0 || conversation.has_unread;
  const preview = conversation.last_message_preview ?? "No messages yet";
  const hasAttachmentHint =
    /\.(png|jpe?g|gif|webp|pdf|docx?|xlsx?|zip)\b/i.test(preview);

  return (
    <div
      role="row"
      data-selected={selected ? "true" : "false"}
      data-conversation-id={conversation.id}
      className={cn(
        "group relative border-b border-inbox-border/80 transition-colors",
        selected ? "bg-brand-soft" : "hover:bg-inbox-hover bg-transparent",
      )}
    >
      {selected ? (
        <span
          className="bg-brand absolute inset-y-0 left-0 w-[3px]"
          aria-hidden="true"
        />
      ) : null}
      <div role="cell" className="w-full">
        <Link
          href={href}
          className="flex gap-3 px-3 py-3 outline-none focus-visible:bg-brand-soft"
        >
          <div className="relative shrink-0">
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-[11px] font-semibold",
                selected
                  ? "bg-brand/15 text-brand"
                  : "bg-neutral-200/80 text-neutral-600",
              )}
              aria-hidden="true"
            >
              {initialsFromLabel(label)}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p
                className={cn(
                  "truncate text-[13px] leading-tight",
                  unread
                    ? "font-semibold text-neutral-900"
                    : "font-medium text-neutral-800",
                )}
              >
                {label}
              </p>
              <time className="text-inbox-muted shrink-0 text-[11px] tabular-nums">
                {formatRelativeTime(conversation.last_message_at)}
              </time>
            </div>

            <div className="mt-0.5 flex items-center gap-1.5">
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] leading-snug",
                  unread ? "text-neutral-700" : "text-inbox-muted",
                )}
              >
                {preview}
              </p>
              {hasAttachmentHint ? (
                <Paperclip
                  className="text-inbox-muted size-3 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              {unread ? (
                <span
                  className="bg-brand text-brand-foreground inline-flex min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  data-testid="conversation-unread-badge"
                  data-unread-count={Math.max(1, conversation.unread_count)}
                  aria-label={
                    conversation.unread_count > 0
                      ? `${String(conversation.unread_count)} unread`
                      : "Unread"
                  }
                >
                  {conversation.unread_count > 99
                    ? "99+"
                    : String(Math.max(1, conversation.unread_count))}
                </span>
              ) : null}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <StatusPill status={conversation.status} />
              <span
                className="text-inbox-muted truncate text-[11px]"
                data-testid="inbox-row-assignee"
                data-assignee-id={conversation.assigned_to?.member_id ?? ""}
              >
                {conversation.assigned_to?.display_label ?? "Unassigned"}
              </span>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
