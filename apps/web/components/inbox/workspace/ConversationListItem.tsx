"use client";

import type { ConversationListItem } from "@site-chat/shared";
import { Paperclip } from "lucide-react";
import Link from "next/link";

import { toAppRoute } from "@/lib/auth/redirect";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";
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

/** Short relative clock for dense inbox rows (list-only; not used in SSR thread). */
function formatListTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${String(days)}d`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function StatusPill({ status }: { status: ConversationListItem["status"] }) {
  if (status === "open") {
    return null;
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
  const isPending = conversation.status === "pending";

  return (
    <div
      role="row"
      data-selected={selected ? "true" : "false"}
      data-conversation-id={conversation.id}
      className={cn(
        "group relative transition-colors",
        selected
          ? "bg-brand-soft shadow-[inset_3px_0_0_0_var(--brand)]"
          : "hover:bg-inbox-hover bg-transparent",
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
          className="flex gap-3.5 px-4 py-3.5 outline-none focus-visible:bg-brand-soft"
        >
          <div className="relative shrink-0 self-start pt-0.5">
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-[12px] font-semibold",
                selected
                  ? "bg-brand/12 text-brand"
                  : "bg-neutral-200/90 text-neutral-600",
              )}
              aria-hidden="true"
            >
              {initialsFromLabel(label)}
            </div>
            {isPending ? (
              <span
                className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-white bg-amber-400"
                title="Pending"
                aria-hidden="true"
              />
            ) : conversation.status === "open" ? (
              <span
                className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-white bg-emerald-500"
                title="Open"
                aria-hidden="true"
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p
                className={cn(
                  "truncate text-[14px] leading-snug",
                  unread
                    ? "font-semibold text-neutral-950"
                    : "font-medium text-neutral-800",
                )}
              >
                {label}
              </p>
              <time className="text-inbox-muted shrink-0 pt-0.5 text-[12px] tabular-nums">
                {formatListTime(conversation.last_message_at)}
              </time>
            </div>

            <div className="mt-1 flex items-center gap-2">
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] leading-snug",
                  unread ? "font-medium text-neutral-700" : "text-inbox-muted",
                )}
              >
                {preview}
              </p>
              {hasAttachmentHint ? (
                <Paperclip
                  className="text-inbox-muted size-3.5 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              {unread ? (
                <span
                  className="bg-brand text-brand-foreground inline-flex min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
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

            <div className="mt-2 flex items-center gap-2">
              <StatusPill status={conversation.status} />
              <span
                className="text-inbox-muted truncate text-[12px]"
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
