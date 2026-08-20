import { Suspense } from "react";

import type { ConversationListItem } from "@site-chat/shared";

import { GlobalSearch } from "@/components/dashboard/global-search/GlobalSearch";
import { NotificationBell } from "@/components/dashboard/notifications/NotificationBell";
import { ConversationList } from "@/components/inbox/workspace/ConversationList";
import { InboxListFilters } from "@/components/inbox/workspace/InboxListFilters";
import { InboxListSearch } from "@/components/inbox/workspace/InboxListSearch";

export function InboxShell({
  workspaceId,
  workspaceSlug,
  memberId,
  canSearchNotes,
  initialItems,
  initialTotal,
  loadError,
  children,
}: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  canSearchNotes: boolean;
  initialItems: ConversationListItem[];
  initialTotal: number;
  loadError: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-inbox-canvas flex h-full min-h-0 w-full"
      data-testid="inbox-workspace-shell"
    >
      <div className="border-inbox-border/80 flex w-[340px] shrink-0 flex-col border-r shadow-[1px_0_0_0_transparent] xl:w-[360px]">
        <div className="border-inbox-border flex shrink-0 items-center gap-2 border-b bg-inbox-panel px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <GlobalSearch
              workspaceSlug={workspaceSlug}
              canSearchNotes={canSearchNotes}
            />
          </div>
          {memberId ? (
            <NotificationBell
              workspaceSlug={workspaceSlug}
              workspaceId={workspaceId}
              memberId={memberId}
            />
          ) : null}
        </div>

        <div className="border-inbox-border shrink-0 space-y-3 border-b bg-inbox-panel px-4 pt-4 pb-3">
          <h1 className="text-[18px] font-semibold tracking-tight text-neutral-950">
            Inbox
          </h1>
          <Suspense fallback={null}>
            <InboxListSearch />
          </Suspense>
        </div>

        <Suspense fallback={null}>
          <InboxListFilters />
        </Suspense>

        {loadError ? (
          <div className="bg-inbox-panel flex flex-1 items-center justify-center p-6">
            <p className="text-destructive text-center text-sm">
              Unable to load conversations. Refresh the page to try again.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={
                <div className="bg-inbox-panel text-inbox-muted flex h-full items-center justify-center text-sm">
                  Loading conversations…
                </div>
              }
            >
              <ConversationList
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                memberId={memberId}
                initialItems={initialItems}
                initialTotal={initialTotal}
              />
            </Suspense>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1">{children}</div>
    </div>
  );
}
