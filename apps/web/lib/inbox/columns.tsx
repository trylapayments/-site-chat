"use client";

import type { ConversationListItem } from "@site-chat/shared";
import { assignmentMessagesEn } from "@site-chat/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { toAppRoute } from "@/lib/auth/redirect";
import {
  formatConversationContactLabel,
  formatRelativeTime,
} from "@/lib/inbox/search-params";
import { cn } from "@/lib/utils";

const assignmentMessages = assignmentMessagesEn;

function StatusBadge({ status }: { status: ConversationListItem["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        status === "open" && "bg-emerald-100 text-emerald-800",
        status === "pending" && "bg-amber-100 text-amber-800",
        status === "resolved" && "bg-sky-100 text-sky-800",
        status === "closed" && "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

export function createInboxColumns(
  workspaceSlug: string,
): ColumnDef<ConversationListItem>[] {
  return [
    {
      id: "contact",
      header: "Contact",
      cell: ({ row }) => {
        const conversation = row.original;
        const label = formatConversationContactLabel(conversation.contact);
        return (
          <Link
            href={toAppRoute(`/app/${workspaceSlug}/inbox/${conversation.id}`)}
            className="hover:text-primary block font-medium"
          >
            <span className="inline-flex items-center gap-2">
              {conversation.unread_count > 0 || conversation.has_unread ? (
                <span
                  className="bg-primary text-primary-foreground inline-flex min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
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
              {label}
            </span>
          </Link>
        );
      },
    },
    {
      id: "last_message_preview",
      header: "Preview",
      cell: ({ row }) => (
        <span className="text-muted-foreground line-clamp-1 text-sm">
          {row.original.last_message_preview ?? "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "assigned_to",
      header: assignmentMessages.assigneeColumn,
      cell: ({ row }) => (
        <span
          className="text-sm"
          data-testid="inbox-row-assignee"
          data-assignee-id={row.original.assigned_to?.member_id ?? ""}
        >
          {row.original.assigned_to?.display_label ??
            assignmentMessages.unassigned}
        </span>
      ),
    },
    {
      id: "last_message_at",
      header: "Last activity",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {formatRelativeTime(row.original.last_message_at)}
        </span>
      ),
    },
  ];
}
