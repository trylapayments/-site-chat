import { notificationsMessagesEn } from "@site-chat/shared";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { NotificationPreferencesForm } from "@/components/settings/NotificationPreferencesForm";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { fetchNotificationPreferences } from "@/lib/notifications/queries";
import { workspaceSettingsPath } from "@/lib/dashboard/routes";
import { createClient } from "@/lib/supabase/server";

const messages = notificationsMessagesEn;

export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  const supabase = await createClient();
  const preferences = await fetchNotificationPreferences(
    supabase,
    workspace.workspace_id,
  );

  return (
    <div className="space-y-8" data-testid="notification-settings-page">
      <PageHeader
        title={messages.settingsLinkLabel}
        description={messages.settingsLinkDescription}
      />
      <Link
        href={toAppRoute(workspaceSettingsPath(workspaceSlug))}
        className="text-primary text-sm font-medium hover:underline"
      >
        Back to settings
      </Link>

      <NotificationPreferencesForm
        workspaceSlug={workspaceSlug}
        initialPreferences={preferences}
      />
    </div>
  );
}
