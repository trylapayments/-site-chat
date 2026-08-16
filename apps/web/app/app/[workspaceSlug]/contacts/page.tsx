import { can, crmMessagesEn } from "@site-chat/shared";
import { Users } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireCrmWorkspace } from "@/lib/crm/guards";
import { fetchContactTags, fetchContacts } from "@/lib/crm/queries";
import {
  workspaceContactsPath,
  workspaceNavPath,
} from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";
import { ContactsSearchForm } from "@/components/contacts/ContactsSearchForm";
import { ContactTagChip } from "@/components/crm/ContactTagsEditor";

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
        <ul className="divide-border divide-y rounded-lg border">
          {contacts.items.map((contact) => {
            const label =
              contact.name?.trim() ||
              contact.email?.trim() ||
              contact.public_id ||
              "Unknown contact";
            return (
              <li key={contact.id}>
                <Link
                  href={toAppRoute(
                    workspaceContactsPath(workspaceSlug, contact.id),
                  )}
                  className="hover:bg-muted/40 focus-visible:ring-ring flex flex-col gap-2 px-4 py-3 transition-colors focus-visible:ring-1 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-muted-foreground text-xs">
                      {[contact.email, contact.job_title, contact.company?.name]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.slice(0, 4).map((tagItem) => (
                      <ContactTagChip key={tagItem.id} tag={tagItem} />
                    ))}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {contacts.has_more ? (
        <p className="text-muted-foreground text-sm">
          More contacts available — refine search to narrow results.
        </p>
      ) : null}

      <Link
        href={toAppRoute(workspaceNavPath(workspaceSlug, "inbox"))}
        className="text-primary text-sm font-medium hover:underline"
      >
        {messages.openInbox}
      </Link>
    </div>
  );
}
