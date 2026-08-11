"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { subscribeOperatorVisitorContext } from "@/lib/realtime/operator-subscriptions";

/**
 * Refreshes the conversation sidebar when visitor identity/context changes.
 *
 * Page views no longer bump `conversations.updated_at` (write-amplification
 * fix), so this subscribes directly to `visitor_sessions` (current URL,
 * device, tab) and `contacts` (identify) UPDATEs by id instead of piggy-
 * backing on the conversation/message channel used by the live thread.
 */
export function VisitorSidebarLiveRefresh({
  workspaceId,
  visitorSessionId,
  contactId,
}: {
  workspaceId: string;
  visitorSessionId: string;
  contactId?: string | null;
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

    const unsubscribe = subscribeOperatorVisitorContext({
      workspaceId,
      visitorSessionId,
      contactId,
      onChange: () => {
        scheduleRefresh();
      },
      onConnectionChange: (status) => {
        // Catch up on any context changes missed while disconnected.
        if (status === "connected") {
          scheduleRefresh();
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
  }, [workspaceId, visitorSessionId, contactId, router]);

  return null;
}
