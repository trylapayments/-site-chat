"use client";

import type { ReactNode } from "react";
import {
  crmMessagesEn,
  type Company,
  type ContactProfile,
  type ContactTag,
} from "@site-chat/shared";
import Link from "next/link";

import { ContactCompanyEditor } from "@/components/crm/ContactCompanyEditor";
import { ContactCustomFieldsEditor } from "@/components/crm/ContactCustomFieldsEditor";
import { ContactIdentityForm } from "@/components/crm/ContactIdentityForm";
import { ContactTagsEditor } from "@/components/crm/ContactTagsEditor";
import { CustomerTimeline } from "@/components/inbox/CustomerTimeline";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import { useContactProfileLiveRefresh } from "@/lib/realtime/use-contact-profile";

const messages = crmMessagesEn;

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ContactProfilePanel({
  workspaceId,
  workspaceSlug,
  profile: initialProfile,
  availableTags,
  companies,
  canEdit,
}: {
  workspaceId: string;
  workspaceSlug: string;
  profile: ContactProfile;
  availableTags: ContactTag[];
  companies: Company[];
  canEdit: boolean;
}) {
  const { profile: liveProfile } = useContactProfileLiveRefresh({
    workspaceId,
    workspaceSlug,
    contactId: initialProfile.id,
    initialProfile,
  });
  const profile = liveProfile ?? initialProfile;

  const deviceLabel = profile.device_summary
    ? [
        profile.device_summary.device_type,
        profile.device_summary.browser_family
          ? `${profile.device_summary.browser_family}${
              profile.device_summary.browser_version
                ? ` ${profile.device_summary.browser_version}`
                : ""
            }`
          : null,
        profile.device_summary.os_family,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="space-y-6" data-testid="contact-profile-panel">
      {!canEdit ? (
        <p className="text-muted-foreground text-sm">{messages.viewerNotice}</p>
      ) : null}

      <Section title={messages.sectionIdentity}>
        {profile.public_id ? (
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-xs">{messages.publicId}</p>
            <p className="font-mono text-xs break-all">{profile.public_id}</p>
          </div>
        ) : null}
        <ContactIdentityForm
          workspaceSlug={workspaceSlug}
          profile={profile}
          canEdit={canEdit}
        />
      </Section>

      <Section title={messages.sectionCompany}>
        <ContactCompanyEditor
          workspaceSlug={workspaceSlug}
          profile={profile}
          companies={companies}
          canEdit={canEdit}
        />
      </Section>

      <Section title={messages.sectionTags}>
        <ContactTagsEditor
          workspaceSlug={workspaceSlug}
          profile={profile}
          availableTags={availableTags}
          canEdit={canEdit}
        />
      </Section>

      <Section title={messages.sectionCustomFields}>
        <ContactCustomFieldsEditor
          workspaceSlug={workspaceSlug}
          profile={profile}
          canEdit={canEdit}
        />
      </Section>

      <Section title={messages.sectionContext}>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">
              {messages.firstSeen}
            </p>
            <p>{formatDateTime(profile.first_seen_at)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{messages.lastSeen}</p>
            <p>{formatDateTime(profile.last_seen_at)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {messages.visitCount}
            </p>
            <p>{profile.visit_count}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {messages.conversationCount}
            </p>
            <p>{profile.conversation_count}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {messages.attachmentCount}
            </p>
            <p>{profile.attachment_count}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {messages.deviceSummary}
            </p>
            <p>{deviceLabel || messages.noDevice}</p>
          </div>
          {profile.current_assignee ? (
            <div>
              <p className="text-muted-foreground text-xs">
                {messages.currentAssignee}
              </p>
              <p>{profile.current_assignee.display_label}</p>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title={messages.sectionConversations}>
        <Link
          href={toAppRoute(workspaceNavPath(workspaceSlug, "inbox"))}
          className="text-primary text-sm font-medium hover:underline"
        >
          {messages.openInbox}
        </Link>
        <p className="text-muted-foreground text-sm">
          {profile.conversation_count} {messages.conversationCount}
        </p>
      </Section>

      <Section title={messages.sectionTimeline}>
        <CustomerTimeline
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          contactId={profile.id}
        />
      </Section>
    </div>
  );
}
