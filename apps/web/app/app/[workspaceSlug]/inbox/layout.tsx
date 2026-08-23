import { can } from "@site-chat/shared";
import { Suspense } from "react";

import { InboxShell } from "@/components/inbox/workspace/InboxShell";
import { requireUser } from "@/lib/auth/session";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { fetchConversations } from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Inbox layout owns the persistent queue column. Filters come from the URL and
 * are applied client-side via useLiveInboxList refresh (layouts cannot read
 * searchParams in the App Router). SSR seeds the default "all" page.
 */
export default async function InboxLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
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
    conversations = await fetchConversations(supabase, workspace.workspace_id, {
      page: 1,
      pageSize: 25,
    });
  } catch {
    loadError = true;
    conversations = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    };
  }

  const canSearchNotes = can(workspace.role, "manage_internal_notes");

  return (
    <Suspense
      fallback={
        <div className="bg-inbox-canvas flex h-full items-center justify-center">
          <p className="text-inbox-muted text-sm">Loading inbox…</p>
        </div>
      }
    >
      <InboxShell
        workspaceId={workspace.workspace_id}
        workspaceSlug={workspaceSlug}
        memberId={memberId}
        canSearchNotes={canSearchNotes}
        initialItems={conversations.items}
        initialTotal={conversations.total}
        loadError={loadError}
      >
        {children}
      </InboxShell>
    </Suspense>
  );
}
