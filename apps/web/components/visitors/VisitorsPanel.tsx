"use client";
import {
  IdentityAvatar,
  CountryFlag,
} from "@/components/dashboard/IdentityAvatar";
import { useEffect, useState, useTransition, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listVisitorsAction,
  startVisitorChatAction,
  type ActiveVisitor,
} from "@/lib/visitors/actions";
function visitorLabel(visitor: ActiveVisitor) {
  return (
    visitor.name ??
    visitor.email ??
    `Visitor ${visitor.ip ?? visitor.id.slice(0, 8)}`
  );
}
function duration(start: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(start)) / 1000),
  );
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}
export function VisitorsPanel({
  slug,
  initial,
  standardMessage,
  canSend,
}: {
  slug: string;
  initial: ActiveVisitor[];
  standardMessage: string;
  canSend: boolean;
}) {
  const [visitors, setVisitors] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState(standardMessage);
  const [notice, setNotice] = useState("");
  const [pollError, setPollError] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await listVisitorsAction(slug);
        if (active) {
          setVisitors(next);
          setPollError(false);
        }
      } catch {
        if (active) setPollError(true);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    const visible = () => {
      void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [slug]);
  const selected = visitors.find((visitor) => visitor.id === selectedId);
  const filtered = visitors.filter(
    (visitor) =>
      (filter === "all" || visitor.status === filter) &&
      [visitor.name, visitor.email, visitor.ip, visitor.url, visitor.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div
      className="h-full overflow-y-auto p-4 md:p-7"
      data-testid="visitors-page"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Visitors</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            See who is on your website and start a conversation.
          </p>
        </div>
        <span role="status" className="text-sm text-emerald-700">
          {pollError
            ? "Reconnecting…"
            : `● Live · ${String(visitors.length)} visitors`}
        </span>
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="min-w-0 rounded-lg border bg-white p-4">
          <Input
            aria-label="Search visitors"
            placeholder="Search by name, email, IP or page"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <div className="my-4 flex flex-wrap gap-2">
            {["all", "browsing", "waiting", "chatting", "invited"].map(
              (status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={filter === status ? "secondary" : "outline"}
                  className="capitalize"
                  onClick={() => {
                    setFilter(status);
                  }}
                >
                  {status} ·{" "}
                  {status === "all"
                    ? visitors.length
                    : visitors.filter((visitor) => visitor.status === status)
                        .length}
                </Button>
              ),
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-3">Visitor</th>
                  <th className="px-2 py-3">Status</th>
                  <th className="px-2 py-3">Current page</th>
                  <th className="hidden px-2 py-3 md:table-cell">
                    Time on site
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((visitor) => (
                  <tr
                    key={visitor.id}
                    aria-selected={visitor.id === selectedId}
                    className={`border-t ${visitor.id === selectedId ? "bg-brand-soft" : ""}`}
                  >
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        className="flex items-center gap-3 text-left font-medium hover:underline"
                        onClick={() => {
                          setSelectedId(visitor.id);
                          setMessage(standardMessage);
                          setNotice("");
                          requestId.current = null;
                        }}
                      >
                        <IdentityAvatar
                          label={visitorLabel(visitor)}
                          country={visitor.country}
                        />
                        {visitorLabel(visitor)}
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {visitor.device ?? "Unknown device"}
                      </p>
                    </td>
                    <td className="px-2 py-3 capitalize">{visitor.status}</td>
                    <td className="max-w-64 px-2 py-3">
                      <p className="truncate">
                        {visitor.title ?? "Untitled page"}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {visitor.url ?? "Page unavailable"}
                      </p>
                    </td>
                    <td className="hidden whitespace-nowrap px-2 py-3 md:table-cell">
                      {duration(visitor.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No active visitors match this view.
            </p>
          ) : null}
          <p className="mt-5 text-xs text-muted-foreground">
            Visitors disappear when their connection expires. Showing up to 200
            active sessions.
          </p>
        </section>
        <section className="space-y-4 rounded-lg border bg-white p-5">
          {selected ? (
            <>
              <h2 className="break-words text-lg font-semibold">
                {visitorLabel(selected)}
              </h2>
              <p className="text-sm capitalize text-muted-foreground">
                <CountryFlag code={selected.country} /> {selected.status}
              </p>
              <dl className="space-y-4 text-sm">
                {[
                  ["Current page", selected.url],
                  ["IP address", selected.ip],
                  [
                    "Device",
                    [selected.device, selected.browser]
                      .filter(Boolean)
                      .join(" · "),
                  ],
                  ["Time on site", duration(selected.startedAt)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words">
                      {value || "Unavailable"}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.conversationId ? (
                <Link
                  className="block text-sm font-medium underline"
                  href={`/app/${slug}/inbox/${selected.conversationId}`}
                >
                  Open conversation
                </Link>
              ) : null}
              {canSend ? (
                <>
                  <h3 className="pt-3 font-semibold">Start a chat</h3>
                  <p className="text-xs text-muted-foreground">
                    Use your saved greeting or write a personal message.
                  </p>
                  <textarea
                    aria-label="Invitation message"
                    className="min-h-28 w-full rounded-md border p-3 text-base md:text-sm"
                    value={message}
                    maxLength={1000}
                    disabled={pending}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      requestId.current = null;
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setMessage(standardMessage);
                      requestId.current = null;
                    }}
                  >
                    Use standard greeting
                  </Button>
                  <Button
                    className="w-full"
                    disabled={pending || !message.trim()}
                    onClick={() => {
                      if (!requestId.current)
                        requestId.current = crypto.randomUUID();
                      startTransition(async () => {
                        const result = await startVisitorChatAction(slug, {
                          visitorId: selected.id,
                          message,
                          requestId: requestId.current,
                        });
                        if (result.success) {
                          setNotice("Invitation sent.");
                          requestId.current = null;
                          setVisitors(await listVisitorsAction(slug));
                        } else setNotice(result.message);
                      });
                    }}
                  >
                    {pending ? "Sending…" : "Start chat"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Operator invitations open the conversation without a
                    pre-chat form.
                  </p>
                  {notice ? (
                    <p role="status" className="text-sm">
                      {notice}
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an active visitor. If they have left, choose another
              visitor.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
