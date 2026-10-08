import { can, crmMessagesEn } from "@site-chat/shared";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { CrmSettingsManager } from "@/components/settings/CrmSettingsManager";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireCrmWorkspace } from "@/lib/crm/guards";
import {
  fetchContactTags,
  fetchCustomFieldDefinitions,
} from "@/lib/crm/queries";
import { workspaceSettingsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";

const messages = crmMessagesEn;

export default async function CrmSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireCrmWorkspace(workspaceSlug);
  const supabase = await createClient();

  const [tags, definitions] = await Promise.all([
    fetchContactTags(supabase, workspace.workspace_id, {}),
    fetchCustomFieldDefinitions(supabase, workspace.workspace_id),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title={messages.settingsPageTitle}
        description={messages.settingsPageDescription}
      />
      <Link
        href={toAppRoute(workspaceSettingsPath(workspaceSlug))}
        className="text-primary text-sm font-medium hover:underline"
      >
        Back to settings
      </Link>

      <CrmSettingsManager
        workspaceSlug={workspaceSlug}
        initialTags={tags.items}
        initialDefinitions={definitions.items}
        canManageTags={can(workspace.role, "update_visitor_profile")}
        canManageDefinitions={can(workspace.role, "manage_crm_definitions")}
      />
    </div>
  );
}
