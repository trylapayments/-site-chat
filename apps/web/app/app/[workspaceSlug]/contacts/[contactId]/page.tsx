import { can, type ConversationListItem } from "@site-chat/shared";
import { notFound } from "next/navigation";

import { ContactProfilePanel } from "@/components/crm/ContactProfilePanel";
import { requireCrmWorkspace } from "@/lib/crm/guards";
import {
  fetchCompanies,
  fetchContactProfile,
  fetchContactTags,
} from "@/lib/crm/queries";
import { fetchConversations } from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";

async function fetchRelatedConversations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  contactId: string,
  searchHint: string | null,
): Promise<ConversationListItem[]> {
  if (!searchHint) {
    return [];
  }
  try {
    const result = await fetchConversations(supabase, workspaceId, {
      page: 1,
      pageSize: 10,
      q: searchHint,
    });
    return result.items.filter((item) => item.contact?.id === contactId);
  } catch {
    return [];
  }
}

export default async function ContactProfilePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; contactId: string }>;
}) {
  const { workspaceSlug, contactId } = await params;
  const { workspace } = await requireCrmWorkspace(workspaceSlug);
  const supabase = await createClient();

  let profile;
  try {
    profile = await fetchContactProfile(
      supabase,
      workspace.workspace_id,
      contactId,
    );
  } catch {
    notFound();
  }

  const searchHint = profile.email?.trim() || profile.name?.trim() || null;

  const [tags, companies, conversations] = await Promise.all([
    fetchContactTags(supabase, workspace.workspace_id, {}),
    fetchCompanies(supabase, workspace.workspace_id, { limit: 100 }),
    fetchRelatedConversations(
      supabase,
      workspace.workspace_id,
      profile.id,
      searchHint,
    ),
  ]);

  return (
    <ContactProfilePanel
      workspaceId={workspace.workspace_id}
      workspaceSlug={workspaceSlug}
      profile={profile}
      availableTags={tags.items}
      companies={companies.items}
      conversations={conversations}
      canEdit={can(workspace.role, "update_visitor_profile")}
    />
  );
}
