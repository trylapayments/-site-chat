"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

export type RealtimeConnectionListener = (
  status:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
) => void;

export function subscribeOperatorWorkspaceInbox(input: {
  workspaceId: string;
  onMessageInsert: (payload: Record<string, unknown>) => void;
  onConversationChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();
  let currentStatus: RealtimeConnectionListener extends (
    status: infer S,
  ) => void
    ? S
    : never = "connecting";
  input.onConnectionChange?.(currentStatus);

  const channel: RealtimeChannel = supabase
    .channel(`workspace:${input.workspaceId}:inbox`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `workspace_id=eq.${input.workspaceId}`,
      },
      (payload) => {
        input.onMessageInsert(payload.new);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "conversations",
        filter: `workspace_id=eq.${input.workspaceId}`,
      },
      (payload) => {
        input.onConversationChange(payload.new);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `workspace_id=eq.${input.workspaceId}`,
      },
      (payload) => {
        input.onConversationChange(payload.new);
      },
    )
    .subscribe((status) => {
      const next = mapChannelStatus(status, currentStatus);
      if (next !== currentStatus) {
        currentStatus = next;
        input.onConnectionChange?.(next);
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeOperatorConversation(input: {
  workspaceId: string;
  conversationId: string;
  onMessageInsert: (payload: Record<string, unknown>) => void;
  onConversationChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();
  let currentStatus: RealtimeConnectionListener extends (
    status: infer S,
  ) => void
    ? S
    : never = "connecting";
  input.onConnectionChange?.(currentStatus);

  const channel: RealtimeChannel = supabase
    .channel(`conversation:${input.conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${input.conversationId}`,
      },
      (payload) => {
        input.onMessageInsert(payload.new);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `id=eq.${input.conversationId}`,
      },
      (payload) => {
        input.onConversationChange(payload.new);
      },
    )
    .subscribe((status) => {
      const next = mapChannelStatus(status, currentStatus);
      if (next !== currentStatus) {
        currentStatus = next;
        input.onConnectionChange?.(next);
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
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
