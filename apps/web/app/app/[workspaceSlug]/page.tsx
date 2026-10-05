import { toAppRoute } from "@/lib/auth/redirect";
import {
  ArrowRight,
  Inbox,
  MessagesSquare,
  Radar,
  UsersRound,
  Code2,
  Settings2,
  CircleCheck,
  Clock3,
} from "lucide-react";
import Link from "next/link";
import { IdentityAvatar } from "@/components/dashboard/IdentityAvatar";
import { OverviewRefresh } from "@/components/dashboard/OverviewRefresh";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  fetchConversations,
  fetchAssignableMembers,
} from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";
import { listVisitorsAction } from "@/lib/visitors/actions";
import { workspaceOperatorStatus } from "@/lib/operators/availability";
import {
  formatConversationContactLabel,
  formatRelativeTime,
} from "@/lib/inbox/search-params";

export default async function WorkspaceHomePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug: slug } = await params;
  const { workspace } = await requireInboxWorkspace(slug);
  const client = await createClient();
  const [unassigned, mine, visitors, team, status] = await Promise.allSettled([
    fetchConversations(client, workspace.workspace_id, {
      status: "open",
      assignment: "unassigned",
      page: 1,
      pageSize: 10,
    }),
    fetchConversations(client, workspace.workspace_id, {
      status: "open",
      assignment: "assigned_to_me",
      page: 1,
      pageSize: 10,
    }),
    listVisitorsAction(slug),
    fetchAssignableMembers(client, workspace.workspace_id),
    workspaceOperatorStatus(workspace.workspace_id),
  ]);
  const base = `/app/${slug}`;
  const metrics = [
    {
      label: "Unassigned open chats",
      value: unassigned.status === "fulfilled" ? unassigned.value.total : "—",
      icon: Inbox,
      href: `${base}/inbox?assignment=unassigned&status=open`,
      detail: "Pick up a conversation",
    },
    {
      label: "Your open chats",
      value: mine.status === "fulfilled" ? mine.value.total : "—",
      icon: MessagesSquare,
      href: `${base}/inbox?assignment=assigned_to_me&status=open`,
      detail: "Continue where you left off",
    },
    {
      label: "Visitors online",
      value: visitors.status === "fulfilled" ? visitors.value.length : "—",
      icon: Radar,
      href: `${base}/visitors`,
      detail: "Offer help while they browse",
    },
  ];
  const chats =
    unassigned.status === "fulfilled" ? unassigned.value.items.slice(0, 5) : [];
  return (
    <div className="space-y-6" data-testid="overview-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-brand">
            Your workspace at a glance
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Let’s make every conversation count.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your conversations, visitors and next steps in one place.
          </p>
        </div>
        <OverviewRefresh />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {metrics.map((m) => (
          <Link
            key={m.label}
            href={toAppRoute(m.href)}
            className="group flex gap-4 rounded-xl border border-inbox-border bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <m.icon className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {m.label}
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-brand">
                {m.value}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {m.detail} <ArrowRight className="inline size-3" />
              </p>
            </div>
          </Link>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-inbox-border bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 className="size-4 text-brand" />
              Ready for an agent
            </h2>
            <Link
              className="text-xs font-medium text-brand hover:underline"
              href={toAppRoute(
                `${base}/inbox?assignment=unassigned&status=open`,
              )}
            >
              View queue →
            </Link>
          </div>
          {unassigned.status === "rejected" ? (
            <p role="status" className="py-6 text-sm text-muted-foreground">
              Unable to load this queue. Try refreshing.
            </p>
          ) : chats.length ? (
            <ul className="divide-y divide-inbox-border">
              {chats.map((c) => (
                <li key={c.id}>
                  <Link
                    href={toAppRoute(`${base}/inbox/${c.id}`)}
                    className="flex items-center gap-3 rounded-lg py-4 hover:bg-inbox-hover"
                  >
                    <IdentityAvatar
                      label={formatConversationContactLabel(c.contact)}
                      country={c.ip_country_code}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {formatConversationContactLabel(c.contact)}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {c.last_message_preview ?? "New conversation"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(c.last_message_at ?? c.created_at)}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-brand" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-5">
              <CircleCheck className="size-6 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-medium">
                  All open chats have an agent.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your team is on top of the queue.
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="rounded-xl border border-inbox-border bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <UsersRound className="size-4 text-brand" />
              Your team
            </h2>
            <Link
              className="text-xs font-medium text-brand"
              href={toAppRoute(`${base}/team`)}
            >
              View team →
            </Link>
          </div>
          <p className="mb-3 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">
            Workspace availability:{" "}
            <span className="font-semibold capitalize">
              {status.status === "fulfilled" ? status.value : "Unavailable"}
            </span>
          </p>
          {team.status === "fulfilled" ? (
            <ul className="divide-y divide-inbox-border">
              {team.value.slice(0, 5).map((m) => (
                <li key={m.member_id} className="flex items-center gap-3 py-3">
                  <IdentityAvatar label={m.display_label} className="size-8" />
                  <p className="min-w-0 truncate text-sm">{m.display_label}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Team details are temporarily unavailable.
            </p>
          )}
        </section>
      </div>
      <section className="rounded-xl border border-inbox-border bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Radar className="size-4 text-brand" />
            On your website now
          </h2>
          <Link
            className="text-xs font-medium text-brand"
            href={toAppRoute(`${base}/visitors`)}
          >
            See visitors →
          </Link>
        </div>
        {visitors.status === "fulfilled" && visitors.value.length ? (
          <ul className="divide-y divide-inbox-border">
            {visitors.value.slice(0, 4).map((v) => (
              <li key={v.id}>
                <Link
                  href={toAppRoute(`${base}/visitors`)}
                  className="flex items-center gap-3 py-3"
                >
                  <IdentityAvatar
                    label={v.name ?? v.email ?? "Visitor"}
                    country={v.country}
                    className="size-8"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {v.name ?? v.email ?? "Visitor"}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {v.title ?? v.url ?? "Browsing your website"}
                    </p>
                  </div>
                  <span className="rounded-md bg-brand-soft px-2 py-1 text-xs capitalize text-brand">
                    {v.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            {visitors.status === "rejected"
              ? "Visitor data is temporarily unavailable."
              : "No visitors are online right now. New sessions will appear here."}
          </p>
        )}
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            title: "Make the chat feel like your brand",
            text: "Appearance, forms, notifications and conversation tools.",
            icon: Settings2,
            href: `${base}/settings`,
          },
          {
            title: "Connect another website",
            text: "Get the installation code and manage your allowed domains.",
            icon: Code2,
            href: `${base}/settings/install`,
          },
        ].map((c) => (
          <Link
            key={c.title}
            href={toAppRoute(c.href)}
            className="flex items-center gap-4 rounded-xl border border-inbox-border bg-white p-5 hover:border-blue-200"
          >
            <c.icon className="size-6 shrink-0 text-brand" />
            <div className="flex-1">
              <h2 className="text-sm font-semibold">{c.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{c.text}</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-brand" />
          </Link>
        ))}
      </div>
    </div>
  );
}
