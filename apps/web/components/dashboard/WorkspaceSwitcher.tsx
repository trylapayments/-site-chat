"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { workspaceInboxesResultSchema } from "@site-chat/shared";
import { subscribeOperatorWorkspaceInbox } from "@/lib/realtime/operator-subscriptions";
import { ChevronsUpDown } from "lucide-react";
import type { AccessibleWorkspace } from "@site-chat/shared";

import { switchWorkspaceAction } from "@/lib/workspace/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  currentPath,
}: {
  workspaces: AccessibleWorkspace[];
  currentWorkspaceId: string;
  currentPath: string;
}) {
  const currentWorkspace = workspaces.find(
    (workspace) => workspace.workspace_id === currentWorkspaceId,
  );

  const allSelected = currentPath.startsWith("/app/all-websites");
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscriptions: (() => void)[] = [];
    const refresh = async () => {
      try {
        const response = await fetch("/api/portal/all-websites?part=counts", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = workspaceInboxesResultSchema.parse(
          await response.json(),
        );
        if (!active) return;
        setCounts(
          Object.fromEntries(
            result.workspaces.map((w) => [w.workspace_id, w.unread_total]),
          ),
        );
        if (!subscriptions.length)
          subscriptions = result.workspaces.map((w) =>
            subscribeOperatorWorkspaceInbox({
              workspaceId: w.workspace_id,
              memberId: w.member_id,
              onMessageInsert: schedule,
              onConversationChange: schedule,
              onMemberReadChange: schedule,
            }),
          );
      } catch {
        /* Keep the last known counts during a connection interruption. */
      }
    };
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 350);
    }
    void refresh();
    const poll = setInterval(() => {
      void refresh();
    }, 30000);
    return () => {
      active = false;
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      for (const stop of subscriptions) stop();
    };
  }, []);
  const otherUnread = Object.entries(counts).reduce(
    (sum, [id, n]) => sum + (id === currentWorkspaceId ? 0 : n),
    0,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[12rem] justify-start truncate"
          aria-label="Switch workspace"
        >
          <span className="truncate">
            {allSelected
              ? "All Websites"
              : (currentWorkspace?.name ?? "Workspace")}
          </span>
          {!allSelected && otherUnread > 0 ? (
            <span className="ml-1 rounded-full bg-brand px-1.5 text-xs text-white">
              {otherUnread}
            </span>
          ) : null}
          <ChevronsUpDown
            className="ml-auto size-3.5 shrink-0"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Websites</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/app/all-websites">All Websites</Link>
        </DropdownMenuItem>
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.workspace_id} asChild>
            <form action={switchWorkspaceAction} className="w-full">
              <input
                type="hidden"
                name="workspaceId"
                value={workspace.workspace_id}
              />
              <input type="hidden" name="currentPath" value={currentPath} />
              <button type="submit" className="w-full cursor-pointer text-left">
                <span className="block truncate font-medium">
                  {workspace.name}
                  {(counts[workspace.workspace_id] ?? 0) > 0 ? (
                    <span className="ml-2 rounded-full bg-brand px-1.5 text-xs text-white">
                      {counts[workspace.workspace_id]}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  /app/{workspace.slug}
                </span>
              </button>
            </form>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
