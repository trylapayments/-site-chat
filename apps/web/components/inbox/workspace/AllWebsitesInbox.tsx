"use client";
import { PortalPageReady } from "@/components/dashboard/PortalPageReady";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  allConversationsResultSchema,
  type AllConversationListItem,
  type workspaceInboxesResultSchema,
} from "@site-chat/shared";
import type { z } from "zod";
import { subscribeOperatorWorkspaceInbox } from "@/lib/realtime/operator-subscriptions";
import { ConversationView } from "./ConversationView";
import type { PortalConversationData } from "@/lib/portal/conversation.server";
import type { ConversationTools } from "@/components/inbox/ConversationToolsProvider";
type List = z.infer<typeof allConversationsResultSchema>;
type Inboxes = z.infer<typeof workspaceInboxesResultSchema>;
export function AllWebsitesInbox({
  initial,
  inboxes,
}: {
  initial: List;
  inboxes: Inboxes;
}) {
  const params = useSearchParams();
  const [website, setWebsite] = useState("");
  const [list, setList] = useState(initial);
  const [group, setGroup] = useState(params.get("statusGroup") ?? "active");
  const [assignment, setAssignment] = useState(
    params.get("assignment") ?? "all",
  );
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AllConversationListItem | null>(
    null,
  );
  const [data, setData] = useState<PortalConversationData | null>(null);
  const [tools, setTools] = useState<ConversationTools | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const first = useRef(!params.get("assignment") && !params.get("statusGroup"));
  const urlAssignment = params.get("assignment");
  const urlGroup = params.get("statusGroup");
  useEffect(() => {
    setAssignment(urlAssignment ?? "all");
    setGroup(urlGroup ?? "active");
    setPage(1);
  }, [urlAssignment, urlGroup]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setRevision((r) => r + 1);
      }, 250);
    };
    const stops = inboxes.workspaces.map((w) =>
      subscribeOperatorWorkspaceInbox({
        workspaceId: w.workspace_id,
        memberId: w.member_id,
        onMessageInsert: refresh,
        onConversationChange: refresh,
        onMemberReadChange: refresh,
      }),
    );
    const poll = setInterval(refresh, 30000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      stops.forEach((stop) => {
        stop();
      });
    };
  }, [inboxes]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          page: String(page),
          statusGroup: group,
          assignment,
          q,
          workspaceId: website,
        });
        void fetch(`/api/portal/all-websites?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        })
          .then(async (response) => {
            if (!response.ok) throw new Error();
            const result = allConversationsResultSchema.parse(
              await response.json(),
            );
            setList(result);
            setError("");
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setError("Unable to refresh conversations. Please try again.");
          });
      },
      q ? 200 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [group, assignment, q, page, revision, website]);
  useEffect(() => {
    if (!selected) {
      setData(null);
      setTools(null);
      return;
    }
    const controller = new AbortController();
    setData(null);
    setTools(null);
    const url = `/api/portal/${encodeURIComponent(selected.workspace.slug)}/conversations/${selected.id}`;
    void fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setData((await response.json()) as PortalConversationData);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Unable to open this conversation.");
      });
    void fetch(`${url}?part=tools`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.ok) setTools((await response.json()) as ConversationTools);
      })
      .catch(() => {});
    return () => {
      controller.abort();
    };
  }, [selected]);
  return (
    <>
      <PortalPageReady />
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          className={`${selected ? "hidden lg:flex" : "flex"} w-full shrink-0 flex-col border-r border-inbox-border bg-white lg:w-[330px]`}
        >
          <div className="border-b border-inbox-border p-4">
            <select
              aria-label="Filter conversations by website"
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value);
                setPage(1);
              }}
              className="mb-3 w-full rounded-md border border-inbox-border bg-white p-2 text-sm"
            >
              <option value="">All Websites</option>
              {inboxes.workspaces.map((w) => (
                <option key={w.workspace_id} value={w.workspace_id}>
                  {w.name}
                </option>
              ))}
            </select>
            <h1 className="text-xl font-semibold">All Websites</h1>
            <p className="mt-1 text-xs text-inbox-muted">
              Every company. One inbox.
            </p>
            <input
              aria-label="Search all conversations"
              placeholder="Search conversations…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="mt-4 w-full rounded-md border px-3 py-2 text-sm"
            />
            <div className="mt-3 flex gap-1" role="tablist">
              {[
                { label: "All open", assignment: "all", group: "active" },
                {
                  label: "Mine",
                  assignment: "assigned_to_me",
                  group: "active",
                },
                {
                  label: "Unassigned",
                  assignment: "unassigned",
                  group: "active",
                },
                { label: "Closed", assignment: "all", group: "completed" },
              ].map((tab) => (
                <button
                  key={tab.label}
                  role="tab"
                  aria-selected={
                    group === tab.group && assignment === tab.assignment
                  }
                  className={`flex-1 whitespace-nowrap rounded-md px-1 py-2 text-xs ${group === tab.group && assignment === tab.assignment ? "bg-blue-50 font-semibold text-blue-700" : "text-inbox-muted"}`}
                  onClick={() => {
                    setGroup(tab.group);
                    setAssignment(tab.assignment);
                    setPage(1);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p role="alert" className="p-3 text-xs text-red-700">
              {error}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setSelected(item);
                }}
                className={`block w-full border-b border-inbox-border p-4 text-left hover:bg-blue-50 ${selected?.id === item.id ? "bg-blue-50" : ""}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  <span className="truncate">
                    {item.contact?.name ?? item.contact?.email ?? "Visitor"}
                  </span>
                  {item.has_unread ? (
                    <span className="rounded-full bg-blue-600 px-1.5 text-xs text-white">
                      {item.unread_count || 1}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block truncate text-xs text-blue-700">
                  {item.workspace.name}
                </span>
                <span className="mt-2 block truncate text-xs text-inbox-muted">
                  {item.last_message_preview ?? "No messages yet"}
                </span>
              </button>
            ))}
            {!list.items.length ? (
              <p className="p-6 text-center text-sm text-inbox-muted">
                No conversations here.
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t p-3 text-xs">
            <button
              disabled={page === 1}
              onClick={() => {
                setPage((p) => p - 1);
              }}
            >
              Previous
            </button>
            <span>{list.total} conversations</span>
            <button
              disabled={page * list.pageSize >= list.total}
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >
              Next
            </button>
          </div>
        </aside>
        <section
          className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col`}
        >
          {selected ? (
            <div className="flex items-center gap-3 border-b border-inbox-border bg-white px-4 py-2 text-xs">
              <button
                className="lg:hidden"
                onClick={() => {
                  setSelected(null);
                }}
              >
                Back
              </button>
              <span className="font-semibold text-blue-700">
                {selected.workspace.name}
              </span>
            </div>
          ) : null}
          {data ? (
            <ConversationView
              key={`${data.workspace.workspace_id}:${data.conversation.id}`}
              data={data}
              tools={tools}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-inbox-muted">
              {selected ? "Opening conversation…" : "Select a conversation"}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
