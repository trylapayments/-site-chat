"use client";
import { can } from "@site-chat/shared";
import { Suspense } from "react";
import { ConversationToolsProvider, type ConversationTools } from "@/components/inbox/ConversationToolsProvider";
import { ConversationMainPanel } from "@/components/inbox/ConversationMainPanel";
import { ConversationVisitorProvider } from "@/components/inbox/ConversationVisitorProvider";
import { ConversationSidebar } from "@/components/inbox/ConversationSidebar";
import { MarkConversationRead } from "@/components/inbox/ConversationThread";
import { ConversationHeader } from "@/components/inbox/workspace/ConversationHeader";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";
import type { PortalConversationData } from "@/lib/portal/conversation.server";
export function ConversationView({ data, tools }: { data: PortalConversationData; tools: ConversationTools | null }) {
  const { workspace, conversation, messages, memberId, memberDisplayLabel } = data;
  const workspaceSlug = workspace.slug;
  const conversationId = conversation.id;
  const canManageNotes = can(workspace.role, "manage_internal_notes");
  const canAssign = can(workspace.role, "assign_conversations");
  const canUseCannedResponses = can(workspace.role, "send_messages") && can(workspace.role, "use_canned_responses");
  const maxSequence = messages.items.reduce(
    (max, message) => Math.max(max, message.sequence_number),
    0,
  );

  const contactLabel = formatConversationContactLabel(conversation.contact);
  const context = conversation.visitor_context;
  const deviceSummary = [
    context?.device_type,
    context?.browser_family
      ? `${context.browser_family}${context.browser_version ? ` ${context.browser_version}` : ""}`
      : null,
    context?.os_family,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ConversationToolsProvider key={conversationId} value={tools}>
    <ConversationVisitorProvider
      key={conversationId}
      workspaceId={workspace.workspace_id}
      initialConversation={conversation}
    >
      <div
        className="flex h-full min-h-0 min-w-0 flex-1"
        data-testid="inbox-conversation-workspace"
      >
        <MarkConversationRead
          workspaceSlug={workspaceSlug}
          conversationId={conversationId}
          throughSequence={maxSequence > 0 ? maxSequence : undefined}
        />

        {/* Active conversation column */}
        <section className="mill-thread-column bg-inbox-surface flex min-h-0 min-w-0 flex-1 flex-col border-r border-inbox-border/70">
          <ConversationHeader
            contactLabel={contactLabel}
            conversationId={conversationId}
            status={conversation.status}
            locationLabel={context?.timezone ?? null}
            deviceLabel={deviceSummary || null}
            pageTitle={context?.current_title ?? null}
            workspaceSlug={workspaceSlug}
            workspaceId={workspace.workspace_id}
            conversation={conversation}
            members={[]}
            memberId={memberId}
            canAssign={canAssign}
            canUpdateStatus={can(workspace.role, "update_conversation_status")}
          />

          <div className="min-h-0 flex-1 overflow-hidden">
            <Suspense
              fallback={
                <p className="text-inbox-muted p-4 text-sm">
                  Loading conversation…
                </p>
              }
            >
              <ConversationMainPanel
                workspaceId={workspace.workspace_id}
                workspaceSlug={workspaceSlug}
                workspaceName={workspace.name}
                conversationId={conversationId}
                ephemeralTopic={conversation.visitor_ephemeral_topic}
                memberId={memberId}
                memberDisplayLabel={memberDisplayLabel}
                initialMessages={messages.items}
                initialVisitorReceipts={{
                  lastDeliveredSequence:
                    conversation.visitor_last_delivered_sequence,
                  lastReadSequence: conversation.visitor_last_read_sequence,
                }}
                initialNotes={[]}
                initialCannedResponses={[]}
                visitorName={conversation.contact?.name ?? null}
                visitorEmail={conversation.contact?.email ?? null}
                members={[]}
                canSend={can(workspace.role, "send_messages")}
                canManageNotes={canManageNotes}
                canUseCannedResponses={canUseCannedResponses}
                aiSuggestedRepliesEnabled={false}
              />
            </Suspense>
          </div>
        </section>

        {/* Customer inspector — collapses before the thread on narrower desktops */}
        <div className="hidden w-[288px] shrink-0 overflow-hidden xl:flex 2xl:w-[310px]">
          <ConversationSidebar
            workspaceId={workspace.workspace_id}
            workspaceSlug={workspaceSlug}
            conversationId={conversationId}
            conversation={conversation}
            members={[]}
            memberId={memberId}
            canAssign={canAssign}
            canUpdateStatus={can(workspace.role, "update_conversation_status")}
            canUpdateVisitor={can(workspace.role, "update_visitor_profile")}
            contactTags={[]}
          />
        </div>
      </div>
    </ConversationVisitorProvider>
    </ConversationToolsProvider>
  );
}
