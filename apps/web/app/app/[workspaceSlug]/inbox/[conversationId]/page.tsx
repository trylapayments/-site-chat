import { can } from "@site-chat/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";
import { ConversationSidebar } from "@/components/inbox/ConversationSidebar";
import {
  MarkConversationRead,
  MessageList,
  ReplyComposer,
} from "@/components/inbox/ConversationThread";
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
        <section className="space-y-4 rounded-lg border p-4">
          <MessageList messages={messages.items} />
          <ReplyComposer
            workspaceSlug={workspaceSlug}
            conversationId={conversationId}
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
