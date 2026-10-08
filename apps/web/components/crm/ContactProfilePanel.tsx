"use client";

import type { ReactNode } from "react";
import {
  crmMessagesEn,
  type Company,
  type ContactProfile,
  type ContactTag,
  type ConversationListItem,
} from "@site-chat/shared";

import { ContactConversations } from "@/components/contacts/ContactConversations";
import {
  contactDisplayLabel,
  contactLocationLabel,
  formatContactDateTime,
  initialsFromLabel,
} from "@/components/contacts/contact-display";
import { ContactCompanyEditor } from "@/components/crm/ContactCompanyEditor";
import { ContactCustomFieldsEditor } from "@/components/crm/ContactCustomFieldsEditor";
import { ContactIdentityForm } from "@/components/crm/ContactIdentityForm";
import { ContactTagsEditor } from "@/components/crm/ContactTagsEditor";
import { CustomerTimeline } from "@/components/inbox/CustomerTimeline";
import { useContactProfileLiveRefresh } from "@/lib/realtime/use-contact-profile";

const messages = crmMessagesEn;

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="border-inbox-border/70 space-y-3 border-b py-5 last:border-b-0"
      data-testid={testId}
    >
      <h2 className="text-[13px] font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ContextItem({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="text-inbox-muted text-[12px]">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-neutral-800">
        {value === null || value === undefined || value === "" ? "—" : value}
      </p>
    </div>
  );
}

export function ContactProfilePanel({
  workspaceId,
  workspaceSlug,
  profile: initialProfile,
  availableTags,
  companies,
  conversations,
  canEdit,
}: {
  workspaceId: string;
  workspaceSlug: string;
  profile: ContactProfile;
  availableTags: ContactTag[];
  companies: Company[];
  conversations: ConversationListItem[];
  canEdit: boolean;
}) {
  const { serverProfile } = useContactProfileLiveRefresh({
    workspaceId,
    workspaceSlug,
    contactId: initialProfile.id,
    initialProfile,
  });
  const profile = serverProfile ?? initialProfile;
  const label = contactDisplayLabel(profile);
  const location = contactLocationLabel(profile);
  const searchHint = profile.email?.trim() || profile.name?.trim() || null;

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
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="contact-profile-panel"
    >
      <header className="border-inbox-border shrink-0 border-b bg-inbox-panel px-5 py-4 xl:px-8">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3.5">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-200/80 text-[14px] font-semibold text-neutral-600"
            aria-hidden="true"
          >
            {initialsFromLabel(label)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold tracking-tight text-neutral-950">
              {label}
            </h1>
            <p className="text-inbox-muted mt-1 truncate text-[13px]">
              {[profile.email, profile.job_title, profile.company?.name]
                .filter(Boolean)
                .join(" · ") || profile.public_id}
            </p>
            {profile.tags.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {profile.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
                    style={{ borderColor: tag.color, color: tag.color }}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    {tag.name}
                  </span>
                ))}
              </div>
            ) : null}
            {!canEdit ? (
              <p className="text-inbox-muted mt-2 text-[12.5px]">
                {messages.viewerNotice}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-0 px-5 py-2 xl:px-8">
          <Section title={messages.sectionIdentity}>
            {profile.public_id ? (
              <div className="mb-3 space-y-0.5">
                <p className="text-inbox-muted text-[12px]">
                  {messages.publicId}
                </p>
                <p
                  className="font-mono text-[12px] break-all text-neutral-700"
                  data-testid="contact-public-id"
                >
                  {profile.public_id}
                </p>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <ContextItem label="Location" value={location} />
              <ContextItem
                label={messages.firstSeen}
                value={formatContactDateTime(profile.first_seen_at)}
              />
              <ContextItem
                label={messages.lastSeen}
                value={formatContactDateTime(profile.last_seen_at)}
              />
              <ContextItem
                label={messages.visitCount}
                value={profile.visit_count}
              />
              <ContextItem
                label={messages.attachmentCount}
                value={profile.attachment_count}
              />
              <ContextItem
                label={messages.deviceSummary}
                value={deviceLabel || messages.noDevice}
              />
              {profile.current_assignee ? (
                <ContextItem
                  label={messages.currentAssignee}
                  value={profile.current_assignee.display_label}
                />
              ) : null}
            </div>
          </Section>

          <Section
            title={messages.sectionConversations}
            testId="contact-conversations-section"
          >
            <ContactConversations
              workspaceSlug={workspaceSlug}
              conversationCount={profile.conversation_count}
              conversations={conversations}
              searchHint={searchHint}
              compact
            />
          </Section>

          <Section title={messages.sectionTimeline} testId="contact-timeline">
            <CustomerTimeline
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              contactId={profile.id}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
