"use client";

import {
  conversationStatusSchema,
  crmMessagesEn,
  buildVisitorIdentityPatch,
  reconcileVisitorIdentityDraft,
  visitorIdentityPatchHasChanges,
  type ContactTagSummary,
  type ConversationDetail,
  type VisitorIdentityDraft,
  type VisitorIdentityValues,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { AssignmentPanel } from "@/components/inbox/AssignmentPanel";
import { VisitorSidebarLiveRefresh } from "@/components/inbox/VisitorSidebarLiveRefresh";
import { CustomerTimeline } from "@/components/inbox/CustomerTimeline";
import { ContactTagChip } from "@/components/crm/ContactTagsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceContactsPath } from "@/lib/dashboard/routes";
import {
  updateConversationStatusAction,
  updateVisitorProfileAction,
} from "@/lib/inbox/actions";
import {
  formatConversationContactLabel,
  formatRelativeTime,
} from "@/lib/inbox/search-params";
import { cn } from "@/lib/utils";

const crmMessages = crmMessagesEn;

type InspectorTab = "details" | "activity";

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

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0] ?? "";
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  const second = parts[1] ?? "";
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

function MetaRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  testId?: string;
}) {
  if (!value) {
    return null;
  }
  return (
    <div
      className="flex items-start justify-between gap-3 py-1.5"
      data-testid={testId}
    >
      <dt className="text-inbox-muted shrink-0 text-[12px]">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] font-medium leading-snug break-all text-neutral-800">
        {value}
      </dd>
    </div>
  );
}

function ContextRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) {
    return null;
  }
  return (
    <div className="space-y-0.5 py-1">
      <p className="text-inbox-muted text-[12px]">{label}</p>
      <p className="break-all text-[13px] text-neutral-800">{value}</p>
    </div>
  );
}

export function ConversationSidebar({
  workspaceId,
  workspaceSlug,
  conversationId,
  conversation,
  members,
  memberId,
  canAssign,
  canUpdateStatus,
  canUpdateVisitor,
  contactTags = [],
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  conversation: ConversationDetail;
  members: WorkspaceMemberOption[];
  memberId: string;
  canAssign: boolean;
  canUpdateStatus: boolean;
  canUpdateVisitor: boolean;
  contactTags?: ContactTagSummary[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("details");

  const visitor = conversation.visitor;
  const contact = conversation.contact;
  const context = conversation.visitor_context;
  const activity = conversation.visitor_activity;

  const publicId = visitor?.public_id ?? contact?.public_id ?? null;
  const serverIdentity: VisitorIdentityValues = {
    name: visitor?.name ?? contact?.name ?? null,
    email: visitor?.email ?? contact?.email ?? null,
    phone: visitor?.phone ?? contact?.phone ?? null,
  };

  const [identity, setIdentity] = useState<{
    baseline: VisitorIdentityValues;
    draft: VisitorIdentityDraft;
  }>(() => ({
    baseline: serverIdentity,
    draft: {
      name: serverIdentity.name ?? "",
      email: serverIdentity.email ?? "",
      phone: serverIdentity.phone ?? "",
    },
  }));
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    if (conversationIdRef.current !== conversationId) {
      conversationIdRef.current = conversationId;
      setIdentity({
        baseline: serverIdentity,
        draft: {
          name: serverIdentity.name ?? "",
          email: serverIdentity.email ?? "",
          phone: serverIdentity.phone ?? "",
        },
      });
      setProfileError(null);
      setTab("details");
      return;
    }

    setIdentity((current) =>
      reconcileVisitorIdentityDraft({
        baseline: current.baseline,
        draft: current.draft,
        server: serverIdentity,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft-preserving reconcile on field values
  }, [
    conversationId,
    serverIdentity.name,
    serverIdentity.email,
    serverIdentity.phone,
  ]);

  const contactLabel = formatConversationContactLabel(
    contact ?? (visitor ? { name: visitor.name, email: visitor.email } : null),
  );
  const locationLabel =
    [context?.timezone, context?.locale].filter(Boolean).join(" · ") || null;
  const lastSeenRaw = activity?.last_seen_at ?? visitor?.last_seen_at ?? null;
  const deviceSummary =
    [
      context?.device_type,
      context?.browser_family
        ? `${context.browser_family}${context.browser_version ? ` ${context.browser_version}` : ""}`
        : null,
      context?.os_family,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  return (
    <aside
      className="bg-inbox-panel flex h-full min-h-0 w-full flex-col overflow-hidden"
      data-testid="customer-inspector"
    >
      <VisitorSidebarLiveRefresh
        workspaceId={workspaceId}
        visitorSessionId={conversation.visitor_session_id}
        contactId={conversation.contact?.id ?? null}
      />

      <div className="border-inbox-border/80 shrink-0 border-b px-4 pt-4 pb-3.5">
        <div className="flex items-start gap-3">
          <div
            className="bg-brand/10 text-brand flex size-11 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tracking-wide"
            aria-hidden="true"
          >
            {initialsFromLabel(contactLabel)}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[15px] font-semibold tracking-tight text-neutral-950">
              {contactLabel}
            </p>
            {locationLabel ? (
              <p className="text-inbox-muted mt-1 truncate text-[12.5px]">
                {locationLabel}
              </p>
            ) : null}
            {lastSeenRaw ? (
              <p className="text-inbox-muted mt-0.5 text-[12px]">
                Last seen {formatRelativeTime(lastSeenRaw)}
              </p>
            ) : null}
          </div>
        </div>

        {!canUpdateVisitor ? (
          <div className="mt-3 space-y-1">
            {serverIdentity.email ? (
              <p className="truncate text-[13px] text-neutral-700">
                {serverIdentity.email}
              </p>
            ) : (
              <p className="text-inbox-muted text-[13px]">No email on file</p>
            )}
            {serverIdentity.phone ? (
              <p className="truncate text-[13px] text-neutral-700">
                {serverIdentity.phone}
              </p>
            ) : null}
          </div>
        ) : null}

        {contactTags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {contactTags.slice(0, 6).map((tag) => (
              <ContactTagChip key={tag.id} tag={tag} />
            ))}
          </div>
        ) : null}

        {contact?.id ? (
          <Link
            href={toAppRoute(workspaceContactsPath(workspaceSlug, contact.id))}
            className="text-brand mt-3 inline-block text-[13px] font-medium hover:underline"
            data-testid="view-full-profile"
          >
            {crmMessages.viewProfile}
          </Link>
        ) : null}
      </div>

      <div
        className="border-inbox-border/80 flex shrink-0 gap-1 border-b px-3 py-1.5"
        role="tablist"
        aria-label="Customer inspector"
      >
        {(
          [
            { id: "details", label: "Details" },
            { id: "activity", label: "Activity" },
          ] as const
        ).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`inspector-${item.id}-tab`}
              onClick={() => {
                setTab(item.id);
              }}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[12.5px] font-semibold transition-colors",
                active
                  ? "bg-zinc-100/80 text-neutral-900"
                  : "text-inbox-muted hover:text-neutral-800",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
        {tab === "details" ? (
          <div
            className="divide-y divide-zinc-100"
            data-testid="inspector-details"
          >
            <section className="py-4">
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                Visitor
              </h2>
              {canUpdateVisitor ? (
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setProfileError(null);
                    const patch = buildVisitorIdentityPatch({
                      baseline: identity.baseline,
                      draft: identity.draft,
                    });
                    if (!visitorIdentityPatchHasChanges(patch)) {
                      return;
                    }
                    const submittedBaseline = identity.baseline;
                    const submittedDraft = identity.draft;
                    startTransition(async () => {
                      const result = await updateVisitorProfileAction(
                        workspaceSlug,
                        {
                          conversationId,
                          ...patch,
                        },
                      );
                      if (result.success) {
                        setIdentity({
                          baseline: {
                            name:
                              patch.name !== undefined
                                ? (patch.name ?? null)
                                : submittedBaseline.name,
                            email:
                              patch.email !== undefined
                                ? (patch.email ?? null)
                                : submittedBaseline.email,
                            phone:
                              patch.phone !== undefined
                                ? (patch.phone ?? null)
                                : submittedBaseline.phone,
                          },
                          draft: submittedDraft,
                        });
                        router.refresh();
                      } else {
                        setProfileError(result.message);
                      }
                    });
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="visitor-name">Name</Label>
                    <Input
                      id="visitor-name"
                      value={identity.draft.name}
                      disabled={isPending}
                      onChange={(event) => {
                        setIdentity((current) => ({
                          ...current,
                          draft: { ...current.draft, name: event.target.value },
                        }));
                      }}
                      maxLength={120}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="visitor-email">Email</Label>
                    <Input
                      id="visitor-email"
                      type="email"
                      value={identity.draft.email}
                      disabled={isPending}
                      onChange={(event) => {
                        setIdentity((current) => ({
                          ...current,
                          draft: {
                            ...current.draft,
                            email: event.target.value,
                          },
                        }));
                      }}
                      maxLength={254}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="visitor-phone">Phone</Label>
                    <Input
                      id="visitor-phone"
                      type="tel"
                      value={identity.draft.phone}
                      disabled={isPending}
                      onChange={(event) => {
                        setIdentity((current) => ({
                          ...current,
                          draft: {
                            ...current.draft,
                            phone: event.target.value,
                          },
                        }));
                      }}
                      maxLength={64}
                      autoComplete="off"
                    />
                  </div>
                  {profileError ? (
                    <p className="text-destructive text-xs">{profileError}</p>
                  ) : null}
                  <Button type="submit" size="sm" disabled={isPending}>
                    Save visitor
                  </Button>
                </form>
              ) : (
                <dl className="mt-2">
                  <MetaRow label="Name" value={contactLabel} />
                  <MetaRow
                    label="Email"
                    value={serverIdentity.email ?? "Not set"}
                  />
                  <MetaRow label="Phone" value={serverIdentity.phone} />
                  {publicId ? (
                    <MetaRow
                      label="Public ID"
                      value={publicId}
                      testId="inspector-public-id"
                    />
                  ) : null}
                </dl>
              )}
            </section>

            <section className="py-4">
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                Conversation
              </h2>
              <dl className="mt-2">
                <MetaRow
                  label="Status"
                  value={
                    conversation.status.charAt(0).toUpperCase() +
                    conversation.status.slice(1)
                  }
                />
                <MetaRow
                  label="Assignee"
                  value={
                    conversation.assigned_to?.display_label ?? "Unassigned"
                  }
                />
                <MetaRow label="Channel" value="Website chat" />
              </dl>
              <div className="mt-3">
                <AssignmentPanel
                  workspaceId={workspaceId}
                  workspaceSlug={workspaceSlug}
                  conversationId={conversationId}
                  conversation={conversation}
                  members={members}
                  memberId={memberId}
                  canAssign={canAssign}
                />
              </div>
              <div className="mt-3 space-y-2">
                <h3 className="text-[12px] font-medium text-neutral-700">
                  Status
                </h3>
                {canUpdateStatus ? (
                  <div className="flex flex-wrap gap-1.5">
                    {conversationStatusSchema.options.map((status) => (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant={
                          conversation.status === status ? "default" : "outline"
                        }
                        className={
                          conversation.status === status
                            ? "bg-brand text-brand-foreground hover:bg-brand/90 h-7 capitalize"
                            : "h-7 capitalize"
                        }
                        disabled={isPending || conversation.status === status}
                        onClick={() => {
                          startTransition(async () => {
                            const result = await updateConversationStatusAction(
                              workspaceSlug,
                              {
                                conversationId,
                                status,
                              },
                            );
                            if (result.success) {
                              router.refresh();
                            }
                          });
                        }}
                      >
                        {status === "closed" ? "Close" : status}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-inbox-muted text-sm capitalize">
                    {conversation.status}
                  </p>
                )}
              </div>
            </section>

            <section className="py-4">
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                Current context
              </h2>
              <div className="mt-2 space-y-0.5">
                <ContextRow
                  label="Page"
                  value={context?.current_title ?? null}
                />
                <ContextRow
                  label="URL"
                  value={context?.current_url ?? conversation.source_url}
                />
                <ContextRow
                  label="Landing"
                  value={context?.landing_url ?? null}
                />
                <ContextRow
                  label="Referrer"
                  value={context?.referrer ?? conversation.referrer ?? null}
                />
                <ContextRow label="Device" value={deviceSummary} />
                <ContextRow label="Locale" value={context?.locale ?? null} />
                <ContextRow
                  label="Timezone"
                  value={context?.timezone ?? null}
                />
                <ContextRow
                  label="Language"
                  value={context?.language ?? null}
                />
                <ContextRow
                  label="Campaign"
                  value={
                    [
                      context?.utm_source,
                      context?.utm_medium,
                      context?.utm_campaign,
                    ]
                      .filter(Boolean)
                      .join(" / ") || null
                  }
                />
                {!context && !conversation.source_url ? (
                  <p className="text-inbox-muted text-[13px]">
                    No page context yet.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="py-4">
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                Activity
              </h2>
              <dl className="mt-2">
                <MetaRow
                  label="First seen"
                  value={formatDateTime(
                    activity?.first_seen_at ?? visitor?.first_seen_at,
                  )}
                />
                <MetaRow
                  label="Last seen"
                  value={formatDateTime(
                    activity?.last_seen_at ?? visitor?.last_seen_at,
                  )}
                />
                <MetaRow
                  label="Visits"
                  value={
                    activity?.visit_count != null ||
                    visitor?.visit_count != null
                      ? String(activity?.visit_count ?? visitor?.visit_count)
                      : null
                  }
                />
              </dl>

              {activity?.recent_page_views &&
              activity.recent_page_views.length > 0 ? (
                <ol className="relative mt-4 space-y-0 border-l border-zinc-200 pl-4">
                  {activity.recent_page_views.map((view) => (
                    <li key={view.id} className="relative pb-3.5 last:pb-0">
                      <span
                        className="bg-brand absolute top-1.5 -left-[1.2rem] size-2 rounded-full border-2 border-white"
                        aria-hidden="true"
                      />
                      <p className="text-[13px] font-medium leading-snug text-neutral-900">
                        {view.title ?? view.url}
                      </p>
                      {view.title ? (
                        <p className="text-inbox-muted mt-0.5 truncate text-[11.5px]">
                          {view.url}
                        </p>
                      ) : null}
                      <p className="text-inbox-muted mt-1 text-[11px]">
                        {formatDateTime(view.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-inbox-muted mt-3 text-[13px]">
                  No recent page views.
                </p>
              )}
            </section>
          </div>
        ) : (
          <div
            className="divide-y divide-zinc-100"
            data-testid="inspector-activity"
          >
            <section className="py-4">
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                Activity
              </h2>
              <p className="text-inbox-muted mt-2 text-[13px]">
                Visitor timeline and page history for this customer.
              </p>
              {activity?.recent_page_views &&
              activity.recent_page_views.length > 0 ? (
                <ol className="relative mt-4 space-y-0 border-l border-zinc-200 pl-4">
                  {activity.recent_page_views.map((view) => (
                    <li key={view.id} className="relative pb-3.5 last:pb-0">
                      <span
                        className="bg-brand absolute top-1.5 -left-[1.2rem] size-2 rounded-full border-2 border-white"
                        aria-hidden="true"
                      />
                      <p className="text-[13px] font-medium leading-snug text-neutral-900">
                        {view.title ?? view.url}
                      </p>
                      {view.title ? (
                        <p className="text-inbox-muted mt-0.5 truncate text-[11.5px]">
                          {view.url}
                        </p>
                      ) : null}
                      <p className="text-inbox-muted mt-1 text-[11px]">
                        {formatDateTime(view.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-inbox-muted mt-3 text-[13px]">
                  No recent page views.
                </p>
              )}
            </section>

            {conversation.contact?.id ? (
              <div className="py-4">
                <CustomerTimeline
                  workspaceId={workspaceId}
                  workspaceSlug={workspaceSlug}
                  contactId={conversation.contact.id}
                  conversationId={conversationId}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
