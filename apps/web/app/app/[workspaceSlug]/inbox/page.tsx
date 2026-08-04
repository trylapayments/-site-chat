import { Suspense } from "react";

import { ListPagination } from "@/components/dashboard/data-table/ListPagination";
import { SearchInput } from "@/components/dashboard/filters/SearchInput";
import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";
import { DashboardPageToolbar } from "@/components/dashboard/layout/DashboardPageToolbar";
import { InboxFilters } from "@/components/inbox/InboxFilters";
import { LiveInboxTable } from "@/components/inbox/LiveInboxTable";
import { createInboxColumns } from "@/lib/inbox/columns";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { fetchConversations } from "@/lib/inbox/queries";
import { parseInboxListQuery } from "@/lib/inbox/search-params";
import { getListQueryPageMeta } from "@/lib/dashboard/search-params";
import { requireUser } from "@/lib/auth/session";
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
  const { user } = await requireUser(supabase);

  let memberId = "";
  if (user) {
    const { data: memberRow } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspace.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();
    memberId = memberRow?.id ?? "";
  }

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
          <LiveInboxTable
            workspaceId={workspace.workspace_id}
            memberId={memberId}
            initialItems={conversations.items}
            query={query}
            columns={columns}
            currentSort={query.sort ?? "-last_message_at"}
            hasFilters={hasFilters}
          />
          <ListPagination pageMeta={pageMeta} />
        </>
      )}
    </DashboardPage>
  );
}
