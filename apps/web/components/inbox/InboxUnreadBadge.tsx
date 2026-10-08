"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchInboxUnreadTotal } from "@/lib/inbox/queries";
import { subscribeOperatorWorkspaceInbox } from "@/lib/realtime/operator-subscriptions";
import { createClient } from "@/lib/supabase/client";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/**
 * Global inbox unread badge. Source of truth is get_inbox_unread_total;
 * member-read CDC + message inserts keep multi-tab views consistent.
 */
export function InboxUnreadBadge({
  workspaceId,
  memberId,
  className,
}: {
  workspaceId: string;
  memberId: string;
  className?: string;
}) {
  const [total, setTotal] = useState(0);
  /** Per-conversation last_read watermark — gates optimistic +1 after mark-read. */
  const lastReadByConversationRef = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient() as AppSupabaseClient;
      const result = await fetchInboxUnreadTotal(supabase, workspaceId);
      setTotal(result.unread_total);
    } catch {
      // Keep last good value; reconnect refresh will retry.
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeOperatorWorkspaceInbox({
      workspaceId,
      memberId,
      onMessageInsert: (raw) => {
        const senderType =
          typeof raw.sender_type === "string" ? raw.sender_type : null;
        const isInternal = Boolean(raw.is_internal);
        if (senderType !== "visitor" || isInternal) {
          return;
        }

        const conversationId =
          typeof raw.conversation_id === "string" ? raw.conversation_id : null;
        const sequence = Number(raw.sequence_number);
        if (!conversationId || !Number.isFinite(sequence)) {
          void refresh();
          return;
        }

        // If mark-read CDC already advanced past this sequence, do not inflate.
        const lastRead =
          lastReadByConversationRef.current.get(conversationId) ?? -1;
        if (sequence > lastRead) {
          setTotal((current) => current + 1);
        }
      },
      onConversationChange: () => {
        // Assignment/status filters do not change global unread; ignore.
      },
      onMemberReadChange: (raw) => {
        const conversationId =
          typeof raw.conversation_id === "string" ? raw.conversation_id : null;
        const lastRead = Number(raw.last_read_sequence);
        if (
          conversationId &&
          Number.isFinite(lastRead) &&
          typeof raw.member_id === "string" &&
          raw.member_id === memberId
        ) {
          const previous =
            lastReadByConversationRef.current.get(conversationId) ?? 0;
          lastReadByConversationRef.current.set(
            conversationId,
            Math.max(previous, Math.floor(lastRead)),
          );
        }
        void refresh();
      },
      onConnectionChange: (state) => {
        if (state === "connected") {
          void refresh();
        }
      },
    });

    return unsubscribe;
  }, [memberId, refresh, workspaceId]);

  if (total <= 0) {
    return null;
  }

  const label = total > 99 ? "99+" : String(total);

  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground ml-auto inline-flex min-w-5 items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        className,
      )}
      data-testid="inbox-unread-total"
      data-unread-total={total}
      aria-label={`${String(total)} unread messages`}
    >
      {label}
    </span>
  );
}
