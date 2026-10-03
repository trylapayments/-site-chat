"use client";

import type { ConversationDetail } from "@site-chat/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { fetchConversation } from "@/lib/inbox/queries";
import { subscribeOperatorVisitorContext } from "@/lib/realtime/operator-subscriptions";
import { createVisitorContextRefresh } from "@/lib/realtime/visitor-context-refresh";
import { createClient } from "@/lib/supabase/client";
import type { AppSupabaseClient } from "@/lib/supabase/server";

type VisitorSnapshot = Pick<
  ConversationDetail,
  "contact" | "visitor" | "visitor_context" | "visitor_activity"
>;

function visitorSnapshot(conversation: ConversationDetail): VisitorSnapshot {
  return {
    contact: conversation.contact,
    visitor: conversation.visitor,
    visitor_context: conversation.visitor_context,
    visitor_activity: conversation.visitor_activity,
  };
}

const VisitorContext = createContext<{
  snapshot: VisitorSnapshot;
  refresh: () => Promise<void>;
  error: string | null;
} | null>(null);

/** One visitor snapshot for the header, inspector and reply variables. */
export function ConversationVisitorProvider({
  workspaceId,
  initialConversation,
  children,
}: {
  workspaceId: string;
  initialConversation: ConversationDetail;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(() =>
    visitorSnapshot(initialConversation),
  );
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<ReturnType<
    typeof createVisitorContextRefresh<ConversationDetail>
  > | null>(null);
  const conversationId = initialConversation.id;
  const visitorSessionId = initialConversation.visitor_session_id;
  const contactId = initialConversation.contact?.id;

  useEffect(() => {
    const refresh = createVisitorContextRefresh({
      read: () =>
        fetchConversation(
          createClient() as AppSupabaseClient,
          workspaceId,
          conversationId,
        ),
      onSnapshot: (conversation) => {
        setSnapshot(visitorSnapshot(conversation));
        setError(null);
      },
      onError: () => {
        setError("Unable to refresh visitor details. Reconnecting…");
      },
    });
    refreshRef.current = refresh;
    const unsubscribe = subscribeOperatorVisitorContext({
      workspaceId,
      visitorSessionId,
      contactId,
      onChange: () => {
        refresh.schedule();
      },
      onConnectionChange: (status) => {
        // Catch up on the first join too: changes can occur after SSR but
        // before the subscription is ready. This does not refresh the route.
        if (status === "connected") refresh.schedule();
      },
    });
    return () => {
      refresh.stop();
      refreshRef.current = null;
      unsubscribe();
    };
  }, [workspaceId, conversationId, visitorSessionId, contactId]);

  useEffect(() => {
    // Other actions may refresh SSR props. Read an authoritative snapshot
    // instead of overwriting a newer CDC snapshot with that render's seed.
    refreshRef.current?.schedule();
  }, [initialConversation]);

  const refresh = useCallback(async () => {
    await refreshRef.current?.refresh();
  }, []);
  const value = useMemo(
    () => ({ snapshot, refresh, error }),
    [snapshot, refresh, error],
  );

  return (
    <VisitorContext.Provider value={value}>{children}</VisitorContext.Provider>
  );
}

export function useConversationVisitorContext() {
  return useContext(VisitorContext);
}
