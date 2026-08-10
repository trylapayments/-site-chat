"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { subscribeOperatorConversation } from "@/lib/realtime/operator-subscriptions";

/**
 * Refreshes the conversation sidebar when visitor identity/context changes.
 * Identify and page-view RPCs touch conversation.updated_at, so a conversation
 * UPDATE subscription is sufficient.
 */
export function VisitorSidebarLiveRefresh({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        return;
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 250);
    };

    const unsubscribe = subscribeOperatorConversation({
      workspaceId,
      conversationId,
      onMessageInsert: () => {
        // Messages are handled by the live thread; ignore here.
      },
      onConversationChange: () => {
        scheduleRefresh();
      },
    });

    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [workspaceId, conversationId, router]);

  return null;
}
