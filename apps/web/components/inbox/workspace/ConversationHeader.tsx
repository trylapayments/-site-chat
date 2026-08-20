"use client";

import {
  conversationStatusSchema,
  type ConversationDetail,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { AssignmentPanel } from "@/components/inbox/AssignmentPanel";
import { Button } from "@/components/ui/button";
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

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium capitalize",
        status === "open" && "bg-emerald-50 text-emerald-700",
        status === "pending" && "bg-amber-50 text-amber-800",
        status === "resolved" && "bg-sky-50 text-sky-800",
        status === "closed" && "bg-neutral-100 text-neutral-500",
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
  );
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
  const shortId = conversationId.slice(0, 8);
  const meta = [locationLabel, deviceLabel, pageTitle]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="border-inbox-border flex shrink-0 items-start justify-between gap-4 border-b bg-inbox-panel px-5 py-4 shadow-[var(--inbox-shadow)]">
      <div className="flex min-w-0 items-start gap-3.5">
        <div
          className="bg-brand/10 text-brand flex size-11 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
          aria-hidden="true"
        >
          {initialsFromLabel(contactLabel)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[17px] font-semibold tracking-tight text-neutral-950">
              {contactLabel}
            </h2>
            <StatusBadge status={status} />
            <span className="text-inbox-muted font-mono text-[12px] tabular-nums">
              #{shortId}
            </span>
          </div>
          <p className="text-inbox-muted mt-1.5 truncate text-[13px]">
            {meta || "No visitor context yet"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
        <div className="max-w-[260px] rounded-lg border border-inbox-border bg-inbox-surface px-2.5 py-2 shadow-[var(--inbox-shadow)]">
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
        </div>

        {canUpdateStatus ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {conversationStatusSchema.options.map((nextStatus) => (
              <Button
                key={nextStatus}
                type="button"
                size="sm"
                variant={status === nextStatus ? "default" : "outline"}
                className={
                  status === nextStatus
                    ? "bg-brand text-brand-foreground hover:bg-brand/90 h-8 capitalize"
                    : "h-8 capitalize"
                }
                disabled={isPending || status === nextStatus}
                onClick={() => {
                  startTransition(async () => {
                    const result = await updateConversationStatusAction(
                      workspaceSlug,
                      {
                        conversationId,
                        status: nextStatus,
                      },
                    );
                    if (result.success) {
                      router.refresh();
                    }
                  });
                }}
              >
                {nextStatus === "closed" ? "Close" : nextStatus}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
