"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

type OperatorSupabaseClient = ReturnType<typeof createClient>;

export type RealtimeConnectionListener = (
  status:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
) => void;

async function applyOperatorRealtimeAuth(supabase: OperatorSupabaseClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    await supabase.realtime.setAuth(session.access_token);
  }
}

function subscribeWithOperatorAuth(input: {
  supabase: OperatorSupabaseClient;
  channelName: string;
  bindings: Array<{
    event: "INSERT" | "UPDATE";
    schema: string;
    table: string;
    filter: string;
    handler: (payload: Record<string, unknown>) => void;
  }>;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  let currentStatus: RealtimeConnectionListener extends (
    status: infer S,
  ) => void
    ? S
    : never = "connecting";
  let channel: RealtimeChannel | null = null;
  let active = true;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let channelEpoch = 0;

  input.onConnectionChange?.(currentStatus);

  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleResubscribe() {
    if (!active || retryTimer !== null) {
      return;
    }
    const delayMs = Math.min(1_000 * 2 ** retryAttempt, 15_000);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (active) {
        void startSubscription();
      }
    }, delayMs);
  }

  async function startSubscription() {
    await applyOperatorRealtimeAuth(input.supabase);
    if (!active) {
      return;
    }

    if (channel) {
      const previous = channel;
      channel = null;
      void input.supabase.removeChannel(previous);
    }

    const epoch = ++channelEpoch;
    // Unique topic per subscribe attempt avoids colliding with a channel that is
    // still being removed after StrictMode remount / CHANNEL_ERROR.
    const topic = `${input.channelName}:${String(epoch)}:${Math.random().toString(36).slice(2, 8)}`;
    let nextChannel = input.supabase.channel(topic);
    for (const binding of input.bindings) {
      nextChannel = nextChannel.on(
        "postgres_changes",
        {
          event: binding.event,
          schema: binding.schema,
          table: binding.table,
          filter: binding.filter,
        },
        (payload) => {
          binding.handler(payload.new);
        },
      );
    }

    channel = nextChannel.subscribe((status) => {
      if (!active || epoch !== channelEpoch) {
        return;
      }

      const next = mapChannelStatus(status, currentStatus);

      if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
      ) {
        const failed = channel;
        channel = null;
        if (failed) {
          void input.supabase.removeChannel(failed);
        }
        if (next !== currentStatus) {
          currentStatus = next;
          input.onConnectionChange?.(next);
        }
        scheduleResubscribe();
        return;
      }

      if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
        channel = null;
        if (next !== currentStatus) {
          currentStatus = next;
          input.onConnectionChange?.(next);
        }
        scheduleResubscribe();
        return;
      }

      // Remaining subscribe callback status is SUBSCRIBED.
      retryAttempt = 0;
      if (next !== currentStatus) {
        currentStatus = next;
        input.onConnectionChange?.(next);
      }
    });
  }

  void startSubscription();

  const {
    data: { subscription: authSubscription },
  } = input.supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.access_token) {
      return;
    }

    void input.supabase.realtime.setAuth(session.access_token);
  });

  return () => {
    active = false;
    clearRetryTimer();
    channelEpoch += 1;
    authSubscription.unsubscribe();
    if (channel) {
      const current = channel;
      channel = null;
      void input.supabase.removeChannel(current);
    }
  };
}

export function subscribeOperatorWorkspaceInbox(input: {
  workspaceId: string;
  onMessageInsert: (payload: Record<string, unknown>) => void;
  onConversationChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `workspace:${input.workspaceId}:inbox`,
    onConnectionChange: input.onConnectionChange,
    bindings: [
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `workspace_id=eq.${input.workspaceId}`,
        handler: input.onMessageInsert,
      },
      {
        event: "INSERT",
        schema: "public",
        table: "conversations",
        filter: `workspace_id=eq.${input.workspaceId}`,
        handler: input.onConversationChange,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `workspace_id=eq.${input.workspaceId}`,
        handler: input.onConversationChange,
      },
    ],
  });
}

export function subscribeOperatorConversation(input: {
  workspaceId: string;
  conversationId: string;
  onMessageInsert: (payload: Record<string, unknown>) => void;
  onConversationChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `conversation:${input.conversationId}`,
    onConnectionChange: input.onConnectionChange,
    bindings: [
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${input.conversationId}`,
        handler: input.onMessageInsert,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `id=eq.${input.conversationId}`,
        handler: input.onConversationChange,
      },
    ],
  });
}

function mapChannelStatus(
  status: REALTIME_SUBSCRIBE_STATES,
  previous:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
): "connecting" | "connected" | "reconnecting" | "disconnected" | "failed" {
  switch (status) {
    case REALTIME_SUBSCRIBE_STATES.SUBSCRIBED:
      return "connected";
    case REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR:
    case REALTIME_SUBSCRIBE_STATES.TIMED_OUT:
      return previous === "connected" ? "reconnecting" : "failed";
    case REALTIME_SUBSCRIBE_STATES.CLOSED:
      return "disconnected";
    default:
      return previous === "connected" ? "reconnecting" : "connecting";
  }
}

export function useOnlineStatus(onChange: (online: boolean) => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const handleOnline = () => {
      onChangeRef.current(true);
    };
    const handleOffline = () => {
      onChangeRef.current(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
}
