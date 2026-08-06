import { can } from "@site-chat/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";
import { ConversationSidebar } from "@/components/inbox/ConversationSidebar";
import { LiveConversationThread } from "@/components/inbox/LiveConversationThread";
import { MarkConversationRead } from "@/components/inbox/ConversationThread";
import { requireUser } from "@/lib/auth/session";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  fetchAssignableMembers,
  fetchConversation,
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

  const members = can(workspace.role, "assign_conversations")
    ? await fetchAssignableMembers(supabase, workspace.workspace_id)
    : [];

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
          <LiveConversationThread
            workspaceId={workspace.workspace_id}
            workspaceSlug={workspaceSlug}
            conversationId={conversationId}
            realtimeTopic={conversation.visitor_realtime_topic}
            memberId={memberId}
            memberDisplayLabel={memberDisplayLabel}
            initialMessages={messages.items}
            canSend={can(workspace.role, "send_messages")}
          />
        </section>

        <ConversationSidebar
          workspaceSlug={workspaceSlug}
          conversationId={conversationId}
          conversation={conversation}
          members={members}
          canAssign={can(workspace.role, "assign_conversations")}
          canUpdateStatus={can(workspace.role, "update_conversation_status")}
        />
      </div>
    </DashboardPage>
  );
}
