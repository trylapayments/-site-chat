import { can } from "@site-chat/shared";
import { Suspense } from "react";

import { ContactsShell } from "@/components/contacts/ContactsShell";
import { requireUser } from "@/lib/auth/session";
import { requireCrmWorkspace } from "@/lib/crm/guards";
import { fetchContactTags, fetchContacts } from "@/lib/crm/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Contacts layout owns the persistent list column (Inbox-parity workspace).
 * Search/tag filters come from the URL and are applied client-side via
 * browser `list_contacts` RPC (layouts cannot read searchParams in the App Router).
 */
export default async function ContactsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireCrmWorkspace(workspaceSlug);
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

  const canView = can(workspace.role, "view_contact_profile");
  const canSearchNotes = can(workspace.role, "manage_internal_notes");

  let contacts = {
    items: [] as Awaited<ReturnType<typeof fetchContacts>>["items"],
    next_before: null as Awaited<
      ReturnType<typeof fetchContacts>
    >["next_before"],
    has_more: false,
  };
  let tags = {
    items: [] as Awaited<ReturnType<typeof fetchContactTags>>["items"],
  };
  let loadError = false;

  if (canView) {
    try {
      const [contactsResult, tagsResult] = await Promise.all([
        fetchContacts(supabase, workspace.workspace_id, { limit: 50 }),
        fetchContactTags(supabase, workspace.workspace_id, {}),
      ]);
      contacts = contactsResult;
      tags = tagsResult;
    } catch {
      loadError = true;
    }
  }

  return (
    <Suspense
      fallback={
        <div className="bg-inbox-canvas flex h-full items-center justify-center">
          <p className="text-inbox-muted text-sm">Loading contacts…</p>
        </div>
      }
    >
      <ContactsShell
        workspaceId={workspace.workspace_id}
        workspaceSlug={workspaceSlug}
        memberId={memberId}
        canSearchNotes={canSearchNotes}
        canView={canView}
        tags={tags.items}
        initialItems={contacts.items}
        initialNextBefore={contacts.next_before}
        initialHasMore={contacts.has_more}
        loadError={loadError}
      >
        {children}
      </ContactsShell>
    </Suspense>
  );
}
