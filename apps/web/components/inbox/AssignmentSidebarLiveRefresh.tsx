"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { subscribeOperatorConversation } from "@/lib/realtime/operator-subscriptions";

/**
 * Refreshes the conversation sidebar when assignment (or other conversation
 * row fields) change via postgres_changes.
 *
 * Catch-up on reconnect recovers missed assignment updates without polling.
 */
export function AssignmentSidebarLiveRefresh({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnectedRef = useRef(false);
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed"
  >("connecting");

  useEffect(() => {
    hasConnectedRef.current = false;

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
        // Messages are handled by LiveConversationThread.
      },
      onConversationChange: () => {
        scheduleRefresh();
      },
      onConnectionChange: (status) => {
        setRealtimeState(status);
        // Refresh on reconnect only — initial connect must not race visitor
        // identify / form hydration (VisitorSidebarLiveRefresh owns that path).
        if (status === "connected") {
          if (hasConnectedRef.current) {
            scheduleRefresh();
          }
          hasConnectedRef.current = true;
        }
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

  return (
    <span
      className="sr-only"
      data-testid="assignment-realtime-ready"
      data-realtime-state={realtimeState}
      aria-hidden="true"
    />
  );
}
