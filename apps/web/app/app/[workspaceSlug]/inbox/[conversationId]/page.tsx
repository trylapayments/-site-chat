import { can, type CannedResponse } from "@site-chat/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";
import { ConversationMainPanel } from "@/components/inbox/ConversationMainPanel";
import { ConversationSidebar } from "@/components/inbox/ConversationSidebar";
import { MarkConversationRead } from "@/components/inbox/ConversationThread";
import { loadWorkspaceAIConfig } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth/session";
import { toAppRoute } from "@/lib/auth/redirect";
import { fetchCannedResponses } from "@/lib/canned/queries";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  fetchAssignableMembers,
  fetchConversation,
  fetchInternalNotes,
  fetchMessages,
} from "@/lib/inbox/queries";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";
import { createClient } from "@/lib/supabase/server";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; conversationId: string }>;
}) {
  const { workspaceSlug, conversationId } = await params;
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
      }),
    ]);
  } catch {
    notFound();
  }

  const canManageNotes = can(workspace.role, "manage_internal_notes");
  const canAssign = can(workspace.role, "assign_conversations");

  const members =
    canManageNotes || canAssign
      ? await fetchAssignableMembers(supabase, workspace.workspace_id)
      : [];

  let initialNotes: Awaited<ReturnType<typeof fetchInternalNotes>>["items"] =
    [];
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
  }

  const canUseCannedResponses =
    can(workspace.role, "send_messages") &&
    can(workspace.role, "use_canned_responses");

  // Prefetched so `/shortcut` resolves on the first keystroke; the composer's
  // realtime hook keeps the list fresh from there. Failure must not block the
  // conversation shell (notes SSR / messages still load).
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

  const maxSequence = messages.items.reduce(
    (max, message) => Math.max(max, message.sequence_number),
    0,
  );

  return (
    <DashboardPage size="full">
      <DashboardPageHeader
        title={formatConversationContactLabel(conversation.contact)}
        description={`Conversation · ${conversation.status}`}
        actions={
          <Link
            href={toAppRoute(workspaceNavPath(workspaceSlug, "inbox"))}
            className="text-primary text-sm font-medium hover:underline"
          >
            Back to inbox
          </Link>
        }
      />

      <MarkConversationRead
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        throughSequence={maxSequence > 0 ? maxSequence : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-lg border p-4">
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
        </section>

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
        />
      </div>
    </DashboardPage>
  );
}
