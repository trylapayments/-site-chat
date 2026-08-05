"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
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

  input.onConnectionChange?.(currentStatus);

  async function startSubscription() {
    await applyOperatorRealtimeAuth(input.supabase);
    if (!active) {
      return;
    }

    let nextChannel = input.supabase.channel(input.channelName);
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
      const next = mapChannelStatus(status, currentStatus);
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
    authSubscription.unsubscribe();
    if (channel) {
      void input.supabase.removeChannel(channel);
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
  status: string,
  previous:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
): "connecting" | "connected" | "reconnecting" | "disconnected" | "failed" {
  if (status === "SUBSCRIBED") {
    return "connected";
  }

  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
    return previous === "connected" ? "reconnecting" : "failed";
  }

  if (status === "CLOSED") {
    return "disconnected";
  }

  return previous === "connected" ? "reconnecting" : "connecting";
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
