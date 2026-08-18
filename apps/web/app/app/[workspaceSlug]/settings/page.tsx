import {
  cannedResponsesMessagesEn,
  crmMessagesEn,
  notificationsMessagesEn,
} from "@site-chat/shared";
import { Bell, MessageSquareQuote, Tags } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { toAppRoute } from "@/lib/auth/redirect";
import {
  SETTINGS_SECTION_CANNED_RESPONSES,
  SETTINGS_SECTION_CRM,
  SETTINGS_SECTION_NOTIFICATIONS,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";

const cannedMessages = cannedResponsesMessagesEn;
const crmMessages = crmMessagesEn;
const notificationMessages = notificationsMessagesEn;

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <div className="space-y-8" data-testid="settings-page">
      <PageHeader
        title="Settings"
        description="Configure workspace tools and personal notification preferences."
      />

      <ul className="grid gap-4 sm:grid-cols-2">
        <li>
          <Link
            href={toAppRoute(
              workspaceSettingsPath(
                workspaceSlug,
                SETTINGS_SECTION_CANNED_RESPONSES,
              ),
            )}
            className="border-border/60 hover:border-border hover:bg-muted/40 focus-visible:ring-ring flex h-full items-start gap-3 rounded-lg border p-4 transition-colors focus-visible:ring-1 focus-visible:outline-none"
            data-testid="settings-link-canned-responses"
          >
            <span
              className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md"
              aria-hidden="true"
            >
              <MessageSquareQuote className="size-5" />
            </span>
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                {cannedMessages.settingsLinkLabel}
              </span>
              <span className="text-muted-foreground block text-sm">
                {cannedMessages.settingsLinkDescription}
              </span>
            </span>
          </Link>
        </li>
        <li>
          <Link
            href={toAppRoute(
              workspaceSettingsPath(workspaceSlug, SETTINGS_SECTION_CRM),
            )}
            className="border-border/60 hover:border-border hover:bg-muted/40 focus-visible:ring-ring flex h-full items-start gap-3 rounded-lg border p-4 transition-colors focus-visible:ring-1 focus-visible:outline-none"
            data-testid="settings-link-crm"
          >
            <span
              className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md"
              aria-hidden="true"
            >
              <Tags className="size-5" />
            </span>
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                {crmMessages.settingsLinkLabel}
              </span>
              <span className="text-muted-foreground block text-sm">
                {crmMessages.settingsLinkDescription}
              </span>
            </span>
          </Link>
        </li>
        <li>
          <Link
            href={toAppRoute(
              workspaceSettingsPath(
                workspaceSlug,
                SETTINGS_SECTION_NOTIFICATIONS,
              ),
            )}
            className="border-border/60 hover:border-border hover:bg-muted/40 focus-visible:ring-ring flex h-full items-start gap-3 rounded-lg border p-4 transition-colors focus-visible:ring-1 focus-visible:outline-none"
            data-testid="settings-link-notifications"
          >
            <span
              className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md"
              aria-hidden="true"
            >
              <Bell className="size-5" />
            </span>
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                {notificationMessages.settingsLinkLabel}
              </span>
              <span className="text-muted-foreground block text-sm">
                {notificationMessages.settingsLinkDescription}
              </span>
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
