"use client";
import { markPortalReady } from "@/lib/portal/startup";

import {
  conversationStatusSchema,
  type ConversationDetail,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { IdentityAvatar } from "@/components/dashboard/IdentityAvatar";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useConversationVisitorContext } from "@/components/inbox/ConversationVisitorProvider";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";
import { MobileConversationDetails } from "@/components/inbox/ConversationEngagement";
import { AssignmentPanel } from "@/components/inbox/AssignmentPanel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateConversationStatusAction } from "@/lib/inbox/actions";
import {
  finishConversationNavigation,
  recordDocumentReady,
  startInteraction,
  finishInteraction,
} from "@/lib/performance/interactions";
import { useConversationTools } from "@/components/inbox/ConversationToolsProvider";
import { cn } from "@/lib/utils";

export function ConversationHeader({
  contactLabel: initialContactLabel,
  conversationId,
  status: serverStatus,
  locationLabel: initialLocationLabel,
  deviceLabel: initialDeviceLabel,
  pageTitle: initialPageTitle,
  workspaceSlug,
  workspaceId,
  conversation,
  members: initialMembers,
  memberId,
  canAssign: initialCanAssign,
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
  const tools = useConversationTools();
  const members = tools?.data?.members ?? initialMembers;
  const canAssign = initialCanAssign && (tools?.ready ?? true);
  const visitorContext = useConversationVisitorContext();
  const context = visitorContext?.snapshot.visitor_context;
  const contactLabel = visitorContext
    ? formatConversationContactLabel(visitorContext.snapshot.contact)
    : initialContactLabel;
  const locationLabel = visitorContext
    ? (context?.timezone ?? null)
    : initialLocationLabel;
  const deviceLabel = visitorContext
    ? [
        context?.device_type,
        context?.browser_family
          ? `${context.browser_family}${context.browser_version ? ` ${context.browser_version}` : ""}`
          : null,
        context?.os_family,
      ]
        .filter(Boolean)
        .join(" · ")
    : initialDeviceLabel;
  const pageTitle = visitorContext
    ? (context?.current_title ?? null)
    : initialPageTitle;
  const router = useRouter();
  const [isPending, setPending] = useState(false);
  const [status, setLocalStatus] = useState(serverStatus);
  const [statusError, setStatusError] = useState<string | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      recordDocumentReady();
      markPortalReady();
      finishConversationNavigation(conversationId);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [conversationId]);
  useEffect(() => {
    setLocalStatus(serverStatus);
    setStatusError(null);
  }, [conversationId, serverStatus]);
  const meta = [locationLabel, deviceLabel, pageTitle]
    .filter(Boolean)
    .join(" · ");
  const otherStatuses = conversationStatusSchema.options.filter(
    (s) => s !== "closed" && s !== status,
  );

  function setStatus(
    nextStatus: (typeof conversationStatusSchema.options)[number],
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setStatusError(null);
    const timing = startInteraction("Change status");
    void (async () => {
      try {
        const result = await updateConversationStatusAction(workspaceSlug, {
          conversationId,
          status: nextStatus,
        });
        finishInteraction(timing, result.success);
        if (result.success) {
          window.dispatchEvent(
            new CustomEvent("mill:conversation-status", {
              detail: { conversationId, workspaceSlug, status: nextStatus },
            }),
          );
          setLocalStatus(nextStatus);
          router.refresh();
        } else {
          setStatusError(result.message);
        }
      } catch {
        finishInteraction(timing, false);
        setStatusError(
          "Unable to change conversation status. Please try again.",
        );
      } finally {
        busyRef.current = false;
        setPending(false);
      }
    })();
  }

  return (
    <header className="mill-conversation-header border-inbox-border/80 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-inbox-panel px-3 py-2 md:flex-nowrap md:gap-4 md:px-5 md:py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
        <Link
          href={`/app/${workspaceSlug}/inbox`}
          aria-label="Back to conversations"
          className="flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-inbox-surface lg:hidden"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <IdentityAvatar
          label={contactLabel}
          country={conversation.ip_country_code}
        />
        <div className="min-w-0 flex-1">
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
        <MobileConversationDetails
          slug={workspaceSlug}
          conversationId={conversationId}
          initialIp={conversation.visitor_ip}
        />
      </div>

      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 md:w-auto md:flex-nowrap">
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
                className="bg-brand text-brand-foreground hover:bg-brand/90 h-11 px-4 md:h-8 md:px-3"
                disabled={isPending}
                onClick={() => {
                  setStatus("closed");
                }}
              >
                {isPending ? "Closing…" : "Close"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11 capitalize md:h-8"
                disabled={isPending}
                onClick={() => {
                  setStatus("open");
                }}
              >
                {isPending ? "Reopening…" : "Reopen"}
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
      {statusError ? (
        <p role="alert" className="w-full text-sm text-red-700">
          {statusError}
        </p>
      ) : null}
    </header>
  );
}
