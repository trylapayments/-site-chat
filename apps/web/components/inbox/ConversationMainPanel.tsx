"use client";

import {
  internalNotesMessagesEn,
  type InternalNote,
  type MessageItem,
  type ReceiptCursors,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { useState } from "react";

import { InternalNotesPanel } from "@/components/inbox/InternalNotesPanel";
import { LiveConversationThread } from "@/components/inbox/LiveConversationThread";

const messages = internalNotesMessagesEn;

type Tab = "messages" | "notes";

export function ConversationMainPanel({
  workspaceId,
  workspaceSlug,
  conversationId,
  ephemeralTopic,
  memberId,
  memberDisplayLabel,
  initialMessages,
  initialVisitorReceipts,
  initialNotes,
  members,
  canSend,
  canManageNotes,
  aiSuggestedRepliesEnabled = false,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  ephemeralTopic: string;
  memberId: string;
  memberDisplayLabel?: string | null;
  initialMessages: MessageItem[];
  initialVisitorReceipts: ReceiptCursors;
  initialNotes: InternalNote[];
  members: WorkspaceMemberOption[];
  canSend: boolean;
  canManageNotes: boolean;
  aiSuggestedRepliesEnabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("messages");

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
          conversationId={conversationId}
          ephemeralTopic={ephemeralTopic}
          memberId={memberId}
          memberDisplayLabel={memberDisplayLabel}
          initialMessages={initialMessages}
          initialVisitorReceipts={initialVisitorReceipts}
          canSend={canSend}
          aiSuggestedRepliesEnabled={aiSuggestedRepliesEnabled}
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
        />
      </div>
    </div>
  );
}
