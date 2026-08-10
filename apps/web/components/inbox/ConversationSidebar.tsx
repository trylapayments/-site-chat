"use client";

import {
  conversationStatusSchema,
  type ConversationDetail,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { VisitorSidebarLiveRefresh } from "@/components/inbox/VisitorSidebarLiveRefresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignConversationAction,
  updateConversationStatusAction,
  updateVisitorProfileAction,
} from "@/lib/inbox/actions";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";

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
  canAssign,
  canUpdateStatus,
  canUpdateVisitor,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  conversation: ConversationDetail;
  members: WorkspaceMemberOption[];
  canAssign: boolean;
  canUpdateStatus: boolean;
  canUpdateVisitor: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [profileError, setProfileError] = useState<string | null>(null);

  const visitor = conversation.visitor;
  const contact = conversation.contact;
  const context = conversation.visitor_context;
  const activity = conversation.visitor_activity;

  const publicId = visitor?.public_id ?? contact?.public_id ?? null;
  const initialName = visitor?.name ?? contact?.name ?? "";
  const initialEmail = visitor?.email ?? contact?.email ?? "";
  const initialPhone = visitor?.phone ?? contact?.phone ?? "";

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);

  useEffect(() => {
    setName(initialName);
    setEmail(initialEmail);
    setPhone(initialPhone);
    setProfileError(null);
  }, [conversationId, initialName, initialEmail, initialPhone]);

  const contactLabel = formatConversationContactLabel(
    contact ?? (visitor ? { name: visitor.name, email: visitor.email } : null),
  );

  return (
    <aside className="space-y-6 rounded-lg border p-4">
      <VisitorSidebarLiveRefresh
        workspaceId={workspaceId}
        conversationId={conversationId}
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
              startTransition(async () => {
                const result = await updateVisitorProfileAction(workspaceSlug, {
                  conversationId,
                  name: name.trim() === "" ? null : name,
                  email: email.trim() === "" ? null : email,
                  phone: phone.trim() === "" ? null : phone,
                });
                if (result.success) {
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
                value={name}
                disabled={isPending}
                onChange={(event) => {
                  setName(event.target.value);
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
                value={email}
                disabled={isPending}
                onChange={(event) => {
                  setEmail(event.target.value);
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
                value={phone}
                disabled={isPending}
                onChange={(event) => {
                  setPhone(event.target.value);
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
            {initialEmail ? (
              <p className="text-muted-foreground text-sm">{initialEmail}</p>
            ) : null}
            {initialPhone ? (
              <p className="text-muted-foreground text-sm">{initialPhone}</p>
            ) : null}
          </div>
        )}
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Assignment</h2>
        {canAssign ? (
          <select
            disabled={isPending}
            value={conversation.assigned_to?.member_id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              startTransition(async () => {
                const result = await assignConversationAction(workspaceSlug, {
                  conversationId,
                  assigneeMemberId: value || null,
                });
                if (result.success) {
                  router.refresh();
                }
              });
            }}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.member_id} value={member.member_id}>
                {member.display_label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-muted-foreground text-sm">
            {conversation.assigned_to?.display_label ?? "Unassigned"}
          </p>
        )}
      </section>

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
