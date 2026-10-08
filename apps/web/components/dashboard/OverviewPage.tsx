"use client";
import {useEffect} from "react";
import {recordStartupStage} from "@/lib/performance/interactions";
import { usePortalResource, usePortalWorkspace } from "./PortalDataProvider";
import type { OverviewData } from "@/lib/portal/overview.server";
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
import { PortalLink as Link } from "./PortalLink";
import { IdentityAvatar } from "@/components/dashboard/IdentityAvatar";
import { OverviewRefresh } from "@/components/dashboard/OverviewRefresh";
import {
  formatConversationContactLabel,
  formatRelativeTime,
} from "@/lib/inbox/search-params";

export function OverviewPage() {
  useEffect(() => {recordStartupStage("Overview mounted");}, []);
  const { slug } = usePortalWorkspace();
  const { data, error, loading, refresh } =
    usePortalResource<OverviewData>("overview");
  if (!data)
    return (
      <div role="status" className="p-6">
        {error ?? "Loading workspace…"}
        {error && (
          <button
            onClick={() => {
              void refresh();
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  const { unassigned, mine, visitors, team, status } = data;
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
    <div className="mill-overview space-y-6" data-testid="overview-page">
      {error && <p role="status">{error} Showing the last loaded data.</p>}
      <div className="mill-overview-welcome flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-brand">
            YOUR WORKSPACE, CONNECTED
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Your day. In conversation.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your conversations, visitors and next steps in one place.
          </p>
        </div>
        <div className="mill-overview-actions">
          <Link
            className="mill-primary-link"
            href={toAppRoute(`${base}/inbox`)}
          >
            Open inbox <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <OverviewRefresh refresh={refresh} pending={loading} />
        </div>
      </div>
      <div className="mill-overview-metrics grid gap-4 sm:grid-cols-3">
        {metrics.map((m) => (
          <Link
            key={m.label}
            href={toAppRoute(m.href)}
            className="mill-metric group flex gap-4 rounded-xl border border-inbox-border bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
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
        <section className="mill-overview-panel rounded-xl border border-inbox-border bg-white p-5">
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
        <section className="mill-overview-panel rounded-xl border border-inbox-border bg-white p-5">
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
      <section className="mill-overview-panel rounded-xl border border-inbox-border bg-white p-5">
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
      <div className="mill-overview-shortcuts grid gap-4 sm:grid-cols-2">
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
