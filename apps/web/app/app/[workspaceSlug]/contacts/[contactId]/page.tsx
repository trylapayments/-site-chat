import { can, crmMessagesEn } from "@site-chat/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContactProfilePanel } from "@/components/crm/ContactProfilePanel";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireCrmWorkspace } from "@/lib/crm/guards";
import {
  fetchCompanies,
  fetchContactProfile,
  fetchContactTags,
} from "@/lib/crm/queries";
import { workspaceContactsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";

const messages = crmMessagesEn;

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

  const [tags, companies] = await Promise.all([
    fetchContactTags(supabase, workspace.workspace_id, {}),
    fetchCompanies(supabase, workspace.workspace_id, { limit: 100 }),
  ]);

  const title =
    profile.name?.trim() ||
    profile.email?.trim() ||
    profile.public_id ||
    messages.profileTitle;

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={messages.profileTitle} />
      <Link
        href={toAppRoute(workspaceContactsPath(workspaceSlug))}
        className="text-primary text-sm font-medium hover:underline"
      >
        {messages.backToContacts}
      </Link>
      <ContactProfilePanel
        workspaceId={workspace.workspace_id}
        workspaceSlug={workspaceSlug}
        profile={profile}
        availableTags={tags.items}
        companies={companies.items}
        canEdit={can(workspace.role, "update_visitor_profile")}
      />
    </div>
  );
}
