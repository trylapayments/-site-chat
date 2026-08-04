"use client";

import { Inbox } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  ConversationListItem,
  ListConversationsQuery,
} from "@site-chat/shared";

import { DataTable } from "@/components/dashboard/data-table/DataTable";
import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { useLiveInboxList } from "@/lib/realtime/use-operator-inbox";

export function LiveInboxTable({
  workspaceId,
  memberId,
  initialItems,
  query,
  columns,
  currentSort,
  hasFilters,
}: {
  workspaceId: string;
  memberId: string;
  initialItems: ConversationListItem[];
  query: ListConversationsQuery;
  columns: ColumnDef<ConversationListItem>[];
  currentSort: string;
  hasFilters: boolean;
}) {
  const { items, connectionState, refreshList } = useLiveInboxList({
    workspaceId,
    memberId,
    initialItems,
    query,
  });

  return (
    <>
      <ConnectionBanner
        state={connectionState}
        onRetry={() => {
          void refreshList();
        }}
      />
      <DataTable
        columns={columns}
        data={items}
        sortableColumns={["last_message_at", "created_at", "status"]}
        currentSort={currentSort}
        emptyState={{
          icon: Inbox,
          title: hasFilters
            ? "No matching conversations"
            : "No conversations yet",
          description: hasFilters
            ? "Try adjusting your search or filters."
            : "Visitor messages will appear here once conversations are created.",
        }}
      />
    </>
  );
}
