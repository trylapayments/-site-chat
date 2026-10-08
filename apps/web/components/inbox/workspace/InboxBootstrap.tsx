"use client";
import { can } from "@site-chat/shared";
import {
  usePortalResource,
  usePortalWorkspace,
} from "@/components/dashboard/PortalDataProvider";
import type { fetchConversations } from "@/lib/inbox/queries";
import { InboxShell } from "./InboxShell";
export function InboxBootstrap({ children }: { children: React.ReactNode }) {
  const { workspaceId, slug, memberId, role } = usePortalWorkspace();
  const { data, error, refresh } =
    usePortalResource<Awaited<ReturnType<typeof fetchConversations>>>("inbox");
  if (!data)
    return (
      <div role="status" className="p-6">
        {error ?? "Loading conversations…"}
        {error && (
          <button
            onClick={() => {
              void refresh();
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  return (
    <InboxShell
      workspaceId={workspaceId}
      workspaceSlug={slug}
      memberId={memberId}
      canSearchNotes={can(role, "manage_internal_notes")}
      initialItems={data.items}
      loadError={false}
      initialTotal={data.total}
    >
      {children}
    </InboxShell>
  );
}
