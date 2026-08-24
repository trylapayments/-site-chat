import { Suspense } from "react";
import { Users } from "lucide-react";
import {
  crmMessagesEn,
  type ContactListItem,
  type ContactTag,
  type ListContactsResult,
} from "@site-chat/shared";

import { ContactsList } from "@/components/contacts/ContactsList";
import { ContactsSearchForm } from "@/components/contacts/ContactsSearchForm";
import { GlobalSearch } from "@/components/dashboard/global-search/GlobalSearch";
import { NotificationBell } from "@/components/dashboard/notifications/NotificationBell";

const messages = crmMessagesEn;

export function ContactsShell({
  workspaceId,
  workspaceSlug,
  memberId,
  canSearchNotes,
  canView,
  tags,
  initialItems,
  initialNextBefore,
  initialHasMore,
  loadError,
  children,
}: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  canSearchNotes: boolean;
  canView: boolean;
  tags: ContactTag[];
  initialItems: ContactListItem[];
  initialNextBefore: ListContactsResult["next_before"];
  initialHasMore: boolean;
  loadError: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-inbox-canvas flex h-full min-h-0 w-full"
      data-testid="contacts-page"
      data-contacts-workspace="true"
    >
      <div className="border-inbox-border/60 flex w-full max-w-full shrink-0 flex-col border-r md:w-[380px] xl:w-[440px] 2xl:w-[480px]">
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
          <div className="flex items-start gap-2.5">
            <div className="bg-brand-soft text-brand mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Users className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[18px] font-semibold tracking-tight text-neutral-950">
                {messages.contactsPageTitle}
              </h1>
              <p className="text-inbox-muted mt-0.5 text-[12.5px] leading-snug">
                Customer profiles for support context
              </p>
            </div>
          </div>
          {canView ? (
            <Suspense fallback={null}>
              <ContactsSearchForm workspaceSlug={workspaceSlug} tags={tags} />
            </Suspense>
          ) : null}
        </div>

        {loadError ? (
          <div className="bg-inbox-panel flex flex-1 items-center justify-center p-6">
            <p className="text-destructive text-center text-sm">
              {messages.contactsError}
            </p>
          </div>
        ) : canView ? (
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={
                <div className="bg-inbox-panel text-inbox-muted flex h-full items-center justify-center text-sm">
                  {messages.contactsLoading}
                </div>
              }
            >
              <ContactsList
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                initialItems={initialItems}
                initialNextBefore={initialNextBefore}
                initialHasMore={initialHasMore}
              />
            </Suspense>
          </div>
        ) : (
          <div className="bg-inbox-panel text-inbox-muted flex flex-1 items-center justify-center p-6 text-sm">
            You do not have permission to view contacts.
          </div>
        )}
      </div>

      <div className="bg-inbox-surface flex min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
