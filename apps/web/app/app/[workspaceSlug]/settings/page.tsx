import { cannedResponsesMessagesEn } from "@site-chat/shared";
import { MessageSquareQuote } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/PageHeader";
import { toAppRoute } from "@/lib/auth/redirect";
import {
  SETTINGS_SECTION_CANNED_RESPONSES,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";

const messages = cannedResponsesMessagesEn;

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
        description="Configure workspace tools. More areas (widget, notifications, billing) arrive with their features."
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
                {messages.settingsLinkLabel}
              </span>
              <span className="text-muted-foreground block text-sm">
                {messages.settingsLinkDescription}
              </span>
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
