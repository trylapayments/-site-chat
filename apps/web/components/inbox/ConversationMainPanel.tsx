"use client";

import {
  internalNotesMessagesEn,
  type CannedResponse,
  type InternalNote,
  type MessageItem,
  type ReceiptCursors,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InternalNotesPanel } from "@/components/inbox/InternalNotesPanel";
import { LiveConversationThread } from "@/components/inbox/LiveConversationThread";

const messages = internalNotesMessagesEn;

type Tab = "messages" | "notes";

export function ConversationMainPanel({
  workspaceId,
  workspaceSlug,
  workspaceName,
  conversationId,
  ephemeralTopic,
  memberId,
  memberDisplayLabel,
  initialMessages,
  initialVisitorReceipts,
  initialNotes,
  initialCannedResponses,
  visitorName,
  visitorEmail,
  members,
  canSend,
  canManageNotes,
  canUseCannedResponses,
  aiSuggestedRepliesEnabled = false,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  conversationId: string;
  ephemeralTopic: string;
  memberId: string;
  memberDisplayLabel?: string | null;
  initialMessages: MessageItem[];
  initialVisitorReceipts: ReceiptCursors;
  initialNotes: InternalNote[];
  initialCannedResponses: CannedResponse[];
  visitorName: string | null;
  visitorEmail: string | null;
  members: WorkspaceMemberOption[];
  canSend: boolean;
  canManageNotes: boolean;
  canUseCannedResponses: boolean;
  aiSuggestedRepliesEnabled?: boolean;
}) {
  const searchParams = useSearchParams();
  const focusMessageId = searchParams.get("message");
  const focusNoteId = searchParams.get("note");
  const initialTab: Tab =
    searchParams.get("tab") === "notes" && canManageNotes
      ? "notes"
      : "messages";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    if (searchParams.get("tab") === "notes" && canManageNotes) {
      setTab("notes");
    } else if (focusMessageId) {
      setTab("messages");
    }
  }, [canManageNotes, focusMessageId, searchParams]);

  return (
    <div className="flex min-h-[520px] flex-col gap-3">
      <div
        className="flex gap-1 border-b"
        role="tablist"
        aria-label="Conversation content"
        data-testid="conversation-main-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "messages"}
          data-testid="conversation-tab-messages"
          className={
            tab === "messages"
              ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium"
              : "text-muted-foreground px-3 py-2 text-sm"
          }
          onClick={() => {
            setTab("messages");
          }}
        >
          {messages.tabMessages}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notes"}
          data-testid="conversation-tab-notes"
          className={
            tab === "notes"
              ? "border-b-2 border-amber-700 px-3 py-2 text-sm font-medium text-amber-950"
              : "text-muted-foreground px-3 py-2 text-sm"
          }
          onClick={() => {
            setTab("notes");
          }}
        >
          {messages.tabNotes}
        </button>
      </div>

      <div
        role="tabpanel"
        hidden={tab !== "messages"}
        className={tab === "messages" ? "block" : "hidden"}
      >
        <LiveConversationThread
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          workspaceName={workspaceName}
          conversationId={conversationId}
          ephemeralTopic={ephemeralTopic}
          memberId={memberId}
          memberDisplayLabel={memberDisplayLabel}
          initialMessages={initialMessages}
          initialVisitorReceipts={initialVisitorReceipts}
          initialCannedResponses={initialCannedResponses}
          visitorName={visitorName}
          visitorEmail={visitorEmail}
          canSend={canSend}
          canUseCannedResponses={canUseCannedResponses}
          aiSuggestedRepliesEnabled={aiSuggestedRepliesEnabled}
          focusMessageId={focusMessageId}
        />
      </div>

      <div
        role="tabpanel"
        hidden={tab !== "notes"}
        className={tab === "notes" ? "block" : "hidden"}
      >
        <InternalNotesPanel
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          conversationId={conversationId}
          memberId={memberId}
          members={members}
          initialNotes={initialNotes}
          canManage={canManageNotes}
          active={tab === "notes"}
          focusNoteId={focusNoteId}
        />
      </div>
    </div>
  );
}
