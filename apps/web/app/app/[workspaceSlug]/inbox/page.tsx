import { Inbox } from "lucide-react";
import { Suspense } from "react";

import { DataTable } from "@/components/dashboard/data-table/DataTable";
import { ListPagination } from "@/components/dashboard/data-table/ListPagination";
import { SearchInput } from "@/components/dashboard/filters/SearchInput";
import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";
import { DashboardPageToolbar } from "@/components/dashboard/layout/DashboardPageToolbar";
import { InboxFilters } from "@/components/inbox/InboxFilters";
import { createInboxColumns } from "@/lib/inbox/columns";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { fetchConversations } from "@/lib/inbox/queries";
import { parseInboxListQuery } from "@/lib/inbox/search-params";
import { getListQueryPageMeta } from "@/lib/dashboard/search-params";
import { createClient } from "@/lib/supabase/server";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  const query = parseInboxListQuery(resolvedSearchParams);
  const supabase = await createClient();

  let conversations;
  let loadError = false;

  try {
    conversations = await fetchConversations(
      supabase,
      workspace.workspace_id,
      query,
    );
  } catch {
    loadError = true;
    conversations = {
      items: [],
      total: 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  const pageMeta = getListQueryPageMeta(query, conversations.total);
  const columns = createInboxColumns(workspaceSlug);
  const hasFilters = Boolean(query.q || query.status || query.assignment);

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Inbox"
        description="Review and respond to customer conversations from one place."
      />
      <DashboardPageToolbar>
        <SearchInput placeholder="Search contacts or messages..." />
        <Suspense fallback={null}>
          <InboxFilters />
        </Suspense>
      </DashboardPageToolbar>

      {loadError ? (
        <p className="text-destructive text-sm">
          Unable to load conversations. Refresh the page to try again.
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={conversations.items}
            sortableColumns={["last_message_at", "created_at", "status"]}
            currentSort={query.sort ?? "-last_message_at"}
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
          <ListPagination pageMeta={pageMeta} />
        </>
      )}
    </DashboardPage>
  );
}
