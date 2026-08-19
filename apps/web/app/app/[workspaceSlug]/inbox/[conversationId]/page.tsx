import {
  can,
  type CannedResponse,
  type ContactTagSummary,
  type InternalNote,
} from "@site-chat/shared";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ConversationMainPanel } from "@/components/inbox/ConversationMainPanel";
import { ConversationSidebar } from "@/components/inbox/ConversationSidebar";
import { MarkConversationRead } from "@/components/inbox/ConversationThread";
import { ConversationHeader } from "@/components/inbox/workspace/ConversationHeader";
import { loadWorkspaceAIConfig } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth/session";
import { fetchCannedResponses } from "@/lib/canned/queries";
import { fetchContactProfile } from "@/lib/crm/queries";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  fetchAssignableMembers,
  fetchConversation,
  fetchInternalNote,
  fetchInternalNotes,
  fetchMessages,
} from "@/lib/inbox/queries";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuidParam(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" && UUID_RE.test(value) ? value : undefined;
}

export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, conversationId } = await params;
  const resolvedSearchParams = await searchParams;
  const focusMessageId = parseUuidParam(resolvedSearchParams.message);
  const focusNoteId = parseUuidParam(resolvedSearchParams.note);
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  let memberId = "";
  let memberDisplayLabel: string | null = null;
  if (user) {
    const { data: memberRow } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspace.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();
    memberId = memberRow?.id ?? "";
    memberDisplayLabel = user.email ?? null;
  }

  let conversation;
  let messages;

  try {
    [conversation, messages] = await Promise.all([
      fetchConversation(supabase, workspace.workspace_id, conversationId),
      fetchMessages(supabase, workspace.workspace_id, conversationId, {
        limit: 50,
        ...(focusMessageId ? { around_message_id: focusMessageId } : {}),
      }),
    ]);
  } catch {
    if (focusMessageId) {
      try {
        [conversation, messages] = await Promise.all([
          fetchConversation(supabase, workspace.workspace_id, conversationId),
          fetchMessages(supabase, workspace.workspace_id, conversationId, {
            limit: 50,
          }),
        ]);
      } catch {
        notFound();
      }
    } else {
      notFound();
    }
  }

  const canManageNotes = can(workspace.role, "manage_internal_notes");
  const canAssign = can(workspace.role, "assign_conversations");

  const members =
    canManageNotes || canAssign
      ? await fetchAssignableMembers(supabase, workspace.workspace_id)
      : [];

  let initialNotes: InternalNote[] = [];
  if (canManageNotes) {
    try {
      const notesResult = await fetchInternalNotes(
        supabase,
        workspace.workspace_id,
        conversationId,
        { limit: 100 },
      );
      initialNotes = notesResult.items;
    } catch {
      initialNotes = [];
    }

    if (focusNoteId && !initialNotes.some((note) => note.id === focusNoteId)) {
      try {
        const focused = await fetchInternalNote(
          supabase,
          workspace.workspace_id,
          focusNoteId,
        );
        if (focused.conversation_id === conversationId && !focused.deleted_at) {
          initialNotes = [...initialNotes, focused];
        }
      } catch {
        // Leave list as-is; client catch-up / panel may still recover.
      }
    }
  }

  const canUseCannedResponses =
    can(workspace.role, "send_messages") &&
    can(workspace.role, "use_canned_responses");

  let initialCannedResponses: CannedResponse[] = [];
  if (canUseCannedResponses) {
    try {
      const canned = await fetchCannedResponses(
        supabase,
        workspace.workspace_id,
        { limit: 200, include_folders: false },
      );
      initialCannedResponses = canned.items;
    } catch {
      initialCannedResponses = [];
    }
  }

  const { flags: aiFlags } = await loadWorkspaceAIConfig(
    supabase,
    workspace.workspace_id,
  );
  const aiSuggestedRepliesEnabled =
    can(workspace.role, "send_messages") && aiFlags.suggestedReplies;

  let contactTags: ContactTagSummary[] = [];
  if (conversation.contact?.id && can(workspace.role, "view_contact_profile")) {
    try {
      const profile = await fetchContactProfile(
        supabase,
        workspace.workspace_id,
        conversation.contact.id,
      );
      contactTags = profile.tags;
    } catch {
      contactTags = [];
    }
  }

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
      <section className="bg-inbox-surface flex min-w-0 flex-1 flex-col border-r border-inbox-border">
        <ConversationHeader
          contactLabel={contactLabel}
          conversationId={conversationId}
          status={conversation.status}
          locationLabel={context?.timezone ?? null}
          deviceLabel={deviceSummary || null}
          pageTitle={context?.current_title ?? null}
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
              initialNotes={initialNotes}
              initialCannedResponses={initialCannedResponses}
              visitorName={conversation.contact?.name ?? null}
              visitorEmail={conversation.contact?.email ?? null}
              members={members}
              canSend={can(workspace.role, "send_messages")}
              canManageNotes={canManageNotes}
              canUseCannedResponses={canUseCannedResponses}
              aiSuggestedRepliesEnabled={aiSuggestedRepliesEnabled}
            />
          </Suspense>
        </div>
      </section>

      {/* Customer inspector — collapses before the thread on narrower desktops */}
      <div className="hidden w-[300px] shrink-0 overflow-hidden xl:flex 2xl:w-[320px]">
        <ConversationSidebar
          workspaceId={workspace.workspace_id}
          workspaceSlug={workspaceSlug}
          conversationId={conversationId}
          conversation={conversation}
          members={members}
          memberId={memberId}
          canAssign={canAssign}
          canUpdateStatus={can(workspace.role, "update_conversation_status")}
          canUpdateVisitor={can(workspace.role, "update_visitor_profile")}
          contactTags={contactTags}
        />
      </div>
    </div>
  );
}
