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
import { formatConversationContactLabel } from "@/lib/inbox/search-params";

const crmMessages = crmMessagesEn;

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
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="break-all text-sm">{value}</p>
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

  return (
    <aside className="space-y-6 rounded-lg border p-4">
      <VisitorSidebarLiveRefresh
        workspaceId={workspaceId}
        visitorSessionId={conversation.visitor_session_id}
        contactId={conversation.contact?.id ?? null}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Visitor</h2>
        <p className="text-sm font-medium">{contactLabel}</p>
        {publicId ? (
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-xs">Public ID</p>
            <p className="font-mono text-xs break-all">{publicId}</p>
          </div>
        ) : null}

        {canUpdateVisitor ? (
          <form
            className="space-y-3"
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
                const result = await updateVisitorProfileAction(workspaceSlug, {
                  conversationId,
                  ...patch,
                });
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
                    draft: { ...current.draft, email: event.target.value },
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
                    draft: { ...current.draft, phone: event.target.value },
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
          <div className="space-y-2">
            {serverIdentity.email ? (
              <p className="text-muted-foreground text-sm">
                {serverIdentity.email}
              </p>
            ) : null}
            {serverIdentity.phone ? (
              <p className="text-muted-foreground text-sm">
                {serverIdentity.phone}
              </p>
            ) : null}
          </div>
        )}

        {contactTags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {contactTags.slice(0, 6).map((tag) => (
              <ContactTagChip key={tag.id} tag={tag} />
            ))}
          </div>
        ) : null}

        {contact?.id ? (
          <Link
            href={toAppRoute(workspaceContactsPath(workspaceSlug, contact.id))}
            className="text-primary text-sm font-medium hover:underline"
          >
            {crmMessages.viewProfile}
          </Link>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Current context</h2>
        <ContextRow label="Page" value={context?.current_title ?? null} />
        <ContextRow
          label="URL"
          value={context?.current_url ?? conversation.source_url}
        />
        <ContextRow label="Landing" value={context?.landing_url ?? null} />
        <ContextRow
          label="Referrer"
          value={context?.referrer ?? conversation.referrer ?? null}
        />
        <ContextRow
          label="Device"
          value={
            [
              context?.device_type,
              context?.browser_family
                ? `${context.browser_family}${context.browser_version ? ` ${context.browser_version}` : ""}`
                : null,
              context?.os_family,
            ]
              .filter(Boolean)
              .join(" · ") || null
          }
        />
        <ContextRow label="Locale" value={context?.locale ?? null} />
        <ContextRow label="Timezone" value={context?.timezone ?? null} />
        <ContextRow label="Language" value={context?.language ?? null} />
        <ContextRow
          label="Campaign"
          value={
            [context?.utm_source, context?.utm_medium, context?.utm_campaign]
              .filter(Boolean)
              .join(" / ") || null
          }
        />
        {!context && !conversation.source_url ? (
          <p className="text-muted-foreground text-sm">No page context yet.</p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Activity</h2>
        <ContextRow
          label="First seen"
          value={formatDateTime(
            activity?.first_seen_at ?? visitor?.first_seen_at,
          )}
        />
        <ContextRow
          label="Last seen"
          value={formatDateTime(
            activity?.last_seen_at ?? visitor?.last_seen_at,
          )}
        />
        <ContextRow
          label="Visits"
          value={
            activity?.visit_count != null || visitor?.visit_count != null
              ? String(activity?.visit_count ?? visitor?.visit_count)
              : null
          }
        />
        {activity?.recent_page_views &&
        activity.recent_page_views.length > 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">Recent pages</p>
            <ul className="space-y-2">
              {activity.recent_page_views.map((view) => (
                <li key={view.id} className="space-y-0.5">
                  <p className="text-sm">{view.title ?? view.url}</p>
                  {view.title ? (
                    <p className="text-muted-foreground break-all text-xs">
                      {view.url}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {formatDateTime(view.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No recent page views.</p>
        )}
      </section>

      {conversation.contact?.id ? (
        <CustomerTimeline
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          contactId={conversation.contact.id}
          conversationId={conversationId}
        />
      ) : null}

      <AssignmentPanel
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        conversation={conversation}
        members={members}
        memberId={memberId}
        canAssign={canAssign}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Status</h2>
        {canUpdateStatus ? (
          <div className="flex flex-wrap gap-2">
            {conversationStatusSchema.options.map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={conversation.status === status ? "default" : "outline"}
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
                {status}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm capitalize">
            {conversation.status}
          </p>
        )}
      </section>
    </aside>
  );
}
