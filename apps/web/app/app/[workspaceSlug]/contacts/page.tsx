import { can, crmMessagesEn } from "@site-chat/shared";
import { Users } from "lucide-react";
import Link from "next/link";

import { ContactsList } from "@/components/contacts/ContactsList";
import { ContactsSearchForm } from "@/components/contacts/ContactsSearchForm";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireCrmWorkspace } from "@/lib/crm/guards";
import { fetchContactTags, fetchContacts } from "@/lib/crm/queries";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";

const messages = crmMessagesEn;

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { q, tag } = await searchParams;
  const { workspace } = await requireCrmWorkspace(workspaceSlug);
  const supabase = await createClient();

  const [contacts, tags] = await Promise.all([
    fetchContacts(supabase, workspace.workspace_id, {
      q: q?.trim() || undefined,
      tag_ids: tag ? [tag] : undefined,
      limit: 50,
    }),
    fetchContactTags(supabase, workspace.workspace_id, {}),
  ]);

  const canView = can(workspace.role, "view_contact_profile");

  return (
    <div className="space-y-8" data-testid="contacts-page">
      <PageHeader
        title={messages.contactsPageTitle}
        description={messages.contactsPageDescription}
      />

      {canView ? (
        <ContactsSearchForm
          workspaceSlug={workspaceSlug}
          initialQuery={q ?? ""}
          tags={tags.items}
          selectedTagId={tag ?? ""}
        />
      ) : null}

      {contacts.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            q || tag ? messages.contactsSearchEmpty : messages.contactsEmpty
          }
          description={
            q || tag
              ? messages.contactsSearchEmpty
              : "Contacts are created when visitors identify themselves during chat."
          }
        />
      ) : (
        <ContactsList
          workspaceSlug={workspaceSlug}
          initialItems={contacts.items}
          initialNextBefore={contacts.next_before}
          initialHasMore={contacts.has_more}
          q={q}
          tagId={tag}
        />
      )}

      <Link
        href={toAppRoute(workspaceNavPath(workspaceSlug, "inbox"))}
        className="text-primary text-sm font-medium hover:underline"
      >
        {messages.openInbox}
      </Link>
    </div>
  );
}
