"use client";

import {
  conversationStatusSchema,
  type ConversationDetail,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  assignConversationAction,
  updateConversationStatusAction,
} from "@/lib/inbox/actions";
import { formatConversationContactLabel } from "@/lib/inbox/search-params";

export function ConversationSidebar({
  workspaceSlug,
  role,
  workspaceId,
  conversationId,
  conversation,
  members,
  canAssign,
  canUpdateStatus,
}: {
  workspaceSlug: string;
  role: "owner" | "admin" | "agent" | "viewer";
  workspaceId: string;
  conversationId: string;
  conversation: ConversationDetail;
  members: WorkspaceMemberOption[];
  canAssign: boolean;
  canUpdateStatus: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const contactLabel = formatConversationContactLabel(conversation.contact);

  return (
    <aside className="space-y-6 rounded-lg border p-4">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Visitor</h2>
        <p className="text-sm font-medium">{contactLabel}</p>
        {conversation.contact?.email ? (
          <p className="text-muted-foreground text-sm">
            {conversation.contact.email}
          </p>
        ) : null}
        {conversation.contact?.phone ? (
          <p className="text-muted-foreground text-sm">
            {conversation.contact.phone}
          </p>
        ) : null}
        {conversation.source_url ? (
          <p className="text-muted-foreground break-all text-xs">
            {conversation.source_url}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Assignment</h2>
        {canAssign ? (
          <select
            disabled={isPending}
            value={conversation.assigned_to?.member_id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              startTransition(async () => {
                const result = await assignConversationAction(
                  workspaceSlug,
                  role,
                  {
                    workspaceId,
                    conversationId,
                    assigneeMemberId: value || null,
                  },
                );
                if (result.success) {
                  router.refresh();
                }
              });
            }}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.member_id} value={member.member_id}>
                {member.display_label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-muted-foreground text-sm">
            {conversation.assigned_to?.display_label ?? "Unassigned"}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Status</h2>
        {canUpdateStatus ? (
          <div className="flex flex-wrap gap-2">
            {conversationStatusSchema.options.map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={conversation.status === status ? "default" : "outline"}
                disabled={isPending || conversation.status === status}
                onClick={() => {
                  startTransition(async () => {
                    const result = await updateConversationStatusAction(
                      workspaceSlug,
                      role,
                      {
                        workspaceId,
                        conversationId,
                        status,
                      },
                    );
                    if (result.success) {
                      router.refresh();
                    }
                  });
                }}
              >
                {status}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm capitalize">
            {conversation.status}
          </p>
        )}
      </section>
    </aside>
  );
}
