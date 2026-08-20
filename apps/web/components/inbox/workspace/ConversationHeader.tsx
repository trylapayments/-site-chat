"use client";

import {
  conversationStatusSchema,
  type ConversationDetail,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { AssignmentPanel } from "@/components/inbox/AssignmentPanel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateConversationStatusAction } from "@/lib/inbox/actions";
import { cn } from "@/lib/utils";

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

export function ConversationHeader({
  contactLabel,
  conversationId,
  status,
  locationLabel,
  deviceLabel,
  pageTitle,
  workspaceSlug,
  workspaceId,
  conversation,
  members,
  memberId,
  canAssign,
  canUpdateStatus,
}: {
  contactLabel: string;
  conversationId: string;
  status: string;
  locationLabel: string | null;
  deviceLabel: string | null;
  pageTitle: string | null;
  workspaceSlug: string;
  workspaceId: string;
  conversation: ConversationDetail;
  members: WorkspaceMemberOption[];
  memberId: string;
  canAssign: boolean;
  canUpdateStatus: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const meta = [locationLabel, deviceLabel, pageTitle]
    .filter(Boolean)
    .join(" · ");
  const otherStatuses = conversationStatusSchema.options.filter(
    (s) => s !== "closed" && s !== status,
  );

  function setStatus(
    nextStatus: (typeof conversationStatusSchema.options)[number],
  ) {
    startTransition(async () => {
      const result = await updateConversationStatusAction(workspaceSlug, {
        conversationId,
        status: nextStatus,
      });
      if (result.success) {
        router.refresh();
      }
    });
  }

  return (
    <header className="border-inbox-border/80 flex shrink-0 items-center justify-between gap-4 border-b bg-inbox-panel px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
          aria-hidden="true"
        >
          {initialsFromLabel(contactLabel)}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold tracking-tight text-neutral-950">
              {contactLabel}
            </h2>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium capitalize",
                status === "open" && "text-emerald-700",
                status === "pending" && "text-amber-700",
                status === "resolved" && "text-sky-700",
                status === "closed" && "text-neutral-500",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status === "open" && "bg-emerald-500",
                  status === "pending" && "bg-amber-500",
                  status === "resolved" && "bg-sky-500",
                  status === "closed" && "bg-neutral-400",
                )}
                aria-hidden="true"
              />
              {status}
            </span>
            <span className="sr-only">Conversation {conversationId}</span>
          </div>
          <p className="text-inbox-muted mt-0.5 truncate text-[12.5px]">
            {meta || "No visitor context yet"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <AssignmentPanel
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          conversationId={conversationId}
          conversation={conversation}
          members={members}
          memberId={memberId}
          canAssign={canAssign}
          variant="header"
        />

        {canUpdateStatus ? (
          <>
            {status !== "closed" ? (
              <Button
                type="button"
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90 h-8 px-3"
                disabled={isPending}
                onClick={() => {
                  setStatus("closed");
                }}
              >
                Close
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 capitalize"
                disabled={isPending}
                onClick={() => {
                  setStatus("open");
                }}
              >
                Reopen
              </Button>
            )}
            {otherStatuses.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-inbox-muted h-8 w-8 px-0"
                    disabled={isPending}
                    aria-label="More status actions"
                  >
                    <MoreHorizontal className="size-4" strokeWidth={1.75} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {otherStatuses.map((nextStatus) => (
                    <DropdownMenuItem
                      key={nextStatus}
                      className="capitalize"
                      disabled={isPending}
                      onSelect={() => {
                        setStatus(nextStatus);
                      }}
                    >
                      Mark {nextStatus}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );
}
