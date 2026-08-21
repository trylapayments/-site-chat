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
import { cn } from "@/lib/utils";

const messages = internalNotesMessagesEn;

type Tab = "messages" | "notes";

function ModeTabs({
  tab,
  canManageNotes,
  onChange,
  testIds = false,
}: {
  tab: Tab;
  canManageNotes: boolean;
  onChange: (next: Tab) => void;
  /** Playwright locators must be unique; both tab panels stay mounted. */
  testIds?: boolean;
}) {
  return (
    <div
      className="bg-inbox-panel flex shrink-0 gap-1 px-5 pt-1"
      role="tablist"
      aria-label="Conversation content"
      data-testid={testIds ? "conversation-main-tabs" : undefined}
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === "messages"}
        data-testid={testIds ? "conversation-tab-messages" : undefined}
        className={cn(
          "relative px-3 py-2 text-[13px] font-medium transition-colors",
          tab === "messages"
            ? "text-brand"
            : "text-inbox-muted hover:text-neutral-800",
        )}
        onClick={() => {
          onChange("messages");
        }}
      >
        Reply
        {tab === "messages" ? (
          <span
            className="bg-brand absolute inset-x-2.5 bottom-0 h-0.5 rounded-full"
            aria-hidden="true"
          />
        ) : null}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "notes"}
        data-testid={testIds ? "conversation-tab-notes" : undefined}
        className={cn(
          "relative px-3 py-2 text-[13px] font-medium transition-colors",
          tab === "notes"
            ? "text-amber-800"
            : "text-inbox-muted hover:text-neutral-800",
          !canManageNotes && "opacity-60",
        )}
        onClick={() => {
          onChange("notes");
        }}
      >
        {messages.tabNotes}
        {tab === "notes" ? (
          <span
            className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-amber-600"
            aria-hidden="true"
          />
        ) : null}
      </button>
    </div>
  );
}

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
  const focusNoteId = searchParams.get("noteId") ?? searchParams.get("note");
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

  const onTabChange = (next: Tab) => {
    if (next === "notes" && !canManageNotes) {
      return;
    }
    setTab(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tabpanel"
        hidden={tab !== "messages"}
        className={
          tab === "messages" ? "flex min-h-0 flex-1 flex-col" : "hidden"
        }
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
          composerAccessory={
            <ModeTabs
              tab={tab}
              canManageNotes={canManageNotes}
              onChange={onTabChange}
              testIds={tab === "messages"}
            />
          }
        />
      </div>

      <div
        role="tabpanel"
        hidden={tab !== "notes"}
        className={tab === "notes" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
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
        <ModeTabs
          tab={tab}
          canManageNotes={canManageNotes}
          onChange={onTabChange}
          testIds={tab === "notes"}
        />
      </div>
    </div>
  );
}
