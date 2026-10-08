"use client";

import { Inbox } from "lucide-react";
import type {
  ConversationListItem,
  ListConversationsQuery,
} from "@site-chat/shared";
import { useMemo } from "react";

import { DataTable } from "@/components/dashboard/data-table/DataTable";
import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { createInboxColumns } from "@/lib/inbox/columns";
import { useLiveInboxList } from "@/lib/realtime/use-operator-inbox";

export function LiveInboxTable({
  workspaceId,
  workspaceSlug,
  memberId,
  initialItems,
  query,
  currentSort,
  hasFilters,
}: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  initialItems: ConversationListItem[];
  query: ListConversationsQuery;
  currentSort: string;
  hasFilters: boolean;
}) {
  const columns = useMemo(
    () => createInboxColumns(workspaceSlug),
    [workspaceSlug],
  );
  const { items, connectionState, refreshList } = useLiveInboxList({
    workspaceId,
    memberId,
    initialItems,
    query,
  });

  return (
    <>
      <span
        data-testid="inbox-realtime-ready"
        data-realtime-state={connectionState}
        hidden
      />
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
