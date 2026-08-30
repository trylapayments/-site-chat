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

async function applyOperatorRealtimeAuth(
  supabase: OperatorSupabaseClient,
): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return null;
  }

  await supabase.realtime.setAuth(session.access_token);
  return session.access_token;
}

type OperatorBinding = {
  event: "INSERT" | "UPDATE" | "DELETE";
  schema: string;
  table: string;
  filter: string;
  handler: (payload: Record<string, unknown>) => void;
};

function subscribeWithOperatorAuth(input: {
  supabase: OperatorSupabaseClient;
  channelName: string;
  bindings: OperatorBinding[];
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
  let appliedAuthToken: string | null = null;

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
    clearRetryTimer();
    const token = await applyOperatorRealtimeAuth(input.supabase);
    if (!active) {
      return;
    }

    // postgres_changes is RLS-filtered; subscribing before setAuth reports
    // SUBSCRIBED but delivers no rows. Wait for onAuthStateChange instead.
    if (!token) {
      return;
    }

    // Same token + live/joining channel: setAuth is enough. INITIAL_SESSION /
    // TOKEN_REFRESHED must not orphan SUBSCRIBED or flip connected→reconnecting
    // (that retriggers list refetch + router.refresh and jerks a idle Inbox).
    if (
      appliedAuthToken === token &&
      channel &&
      (currentStatus === "connected" || currentStatus === "connecting")
    ) {
      return;
    }

    appliedAuthToken = token;

    if (channel) {
      const previous = channel;
      channel = null;
      void input.supabase.removeChannel(previous);
      // Surface a status transition so consumers refresh after auth-driven
      // resubscribe (React ignores setState of the same "connected" value).
      if (currentStatus === "connected") {
        currentStatus = "reconnecting";
        input.onConnectionChange?.(currentStatus);
      }
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
          // DELETE carries the removed row in `old` (REPLICA IDENTITY FULL).
          binding.handler(
            binding.event === "DELETE" ? payload.old : payload.new,
          );
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

    void (async () => {
      await input.supabase.realtime.setAuth(session.access_token);
      if (!active) {
        return;
      }
      // Resubscribe after auth so CDC bindings are authorized. setAuth alone
      // does not retrofit an already-joined postgres_changes channel.
      void startSubscription();
    })();
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
  memberId: string;
  onMessageInsert: (payload: Record<string, unknown>) => void;
  onConversationChange: (payload: Record<string, unknown>) => void;
  onMemberReadChange?: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  const bindings: Array<{
    event: "INSERT" | "UPDATE";
    schema: string;
    table: string;
    filter: string;
    handler: (payload: Record<string, unknown>) => void;
  }> = [
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
  ];

  if (input.onMemberReadChange) {
    bindings.push(
      {
        event: "INSERT",
        schema: "public",
        table: "conversation_member_reads",
        filter: `member_id=eq.${input.memberId}`,
        handler: input.onMemberReadChange,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "conversation_member_reads",
        filter: `member_id=eq.${input.memberId}`,
        handler: input.onMemberReadChange,
      },
    );
  }

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `workspace:${input.workspaceId}:inbox`,
    onConnectionChange: input.onConnectionChange,
    bindings,
  });
}

export function subscribeOperatorConversation(input: {
  workspaceId: string;
  conversationId: string;
  onMessageInsert: (payload: Record<string, unknown>) => void;
  onConversationChange: (payload: Record<string, unknown>) => void;
  /** Durable visitor receipt cursor advances (INSERT/UPDATE). */
  onVisitorReceiptChange?: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  const bindings: Array<{
    event: "INSERT" | "UPDATE";
    schema: string;
    table: string;
    filter: string;
    handler: (payload: Record<string, unknown>) => void;
  }> = [
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
  ];

  if (input.onVisitorReceiptChange) {
    bindings.push(
      {
        event: "INSERT",
        schema: "public",
        table: "conversation_visitor_reads",
        filter: `conversation_id=eq.${input.conversationId}`,
        handler: input.onVisitorReceiptChange,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "conversation_visitor_reads",
        filter: `conversation_id=eq.${input.conversationId}`,
        handler: input.onVisitorReceiptChange,
      },
    );
  }

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `conversation:${input.conversationId}`,
    onConnectionChange: input.onConnectionChange,
    bindings,
  });
}

/**
 * Live internal notes for an open conversation (operator-only via RLS).
 * Soft deletes arrive as UPDATE with deleted_at set.
 */
export function subscribeOperatorInternalNotes(input: {
  workspaceId: string;
  conversationId: string;
  onNoteChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `conversation-notes:${input.conversationId}`,
    onConnectionChange: input.onConnectionChange,
    bindings: [
      {
        event: "INSERT",
        schema: "public",
        table: "internal_notes",
        filter: `conversation_id=eq.${input.conversationId}`,
        handler: input.onNoteChange,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "internal_notes",
        filter: `conversation_id=eq.${input.conversationId}`,
        handler: input.onNoteChange,
      },
    ],
  });
}

/**
 * Live canned responses, folders and the caller's own favorites.
 *
 * Snippets and folders are workspace-filtered (RLS still hides other members'
 * personal rows); favorites are filtered to the calling member because pins are
 * private. Soft deletes arrive as UPDATE with `deleted_at` set, while
 * un-favoriting is a real DELETE.
 */
export function subscribeOperatorCannedResponses(input: {
  workspaceId: string;
  memberId: string;
  onResponseChange: (payload: Record<string, unknown>) => void;
  onFolderChange?: (payload: Record<string, unknown>) => void;
  onFavoriteChange?: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  const bindings: OperatorBinding[] = [
    {
      event: "INSERT",
      schema: "public",
      table: "canned_responses",
      filter: `workspace_id=eq.${input.workspaceId}`,
      handler: input.onResponseChange,
    },
    {
      event: "UPDATE",
      schema: "public",
      table: "canned_responses",
      filter: `workspace_id=eq.${input.workspaceId}`,
      handler: input.onResponseChange,
    },
  ];

  if (input.onFolderChange) {
    bindings.push(
      {
        event: "INSERT",
        schema: "public",
        table: "canned_response_folders",
        filter: `workspace_id=eq.${input.workspaceId}`,
        handler: input.onFolderChange,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "canned_response_folders",
        filter: `workspace_id=eq.${input.workspaceId}`,
        handler: input.onFolderChange,
      },
    );
  }

  if (input.onFavoriteChange && input.memberId) {
    bindings.push(
      {
        event: "INSERT",
        schema: "public",
        table: "canned_response_favorites",
        filter: `member_id=eq.${input.memberId}`,
        handler: input.onFavoriteChange,
      },
      {
        event: "DELETE",
        schema: "public",
        table: "canned_response_favorites",
        filter: `member_id=eq.${input.memberId}`,
        handler: input.onFavoriteChange,
      },
    );
  }

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `canned-responses:${input.workspaceId}`,
    onConnectionChange: input.onConnectionChange,
    bindings,
  });
}

/**
 * Durable in-app notifications for the current member.
 * INSERT/UPDATE on notifications + unread counter CDC for the badge.
 */
export function subscribeOperatorNotifications(input: {
  workspaceId: string;
  memberId: string;
  onInsert: (payload: Record<string, unknown>) => void;
  onUpdate?: (payload: Record<string, unknown>) => void;
  onUnreadCountChange?: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  const bindings: OperatorBinding[] = [
    {
      event: "INSERT",
      schema: "public",
      table: "notifications",
      filter: `recipient_id=eq.${input.memberId}`,
      handler: input.onInsert,
    },
  ];

  if (input.onUpdate) {
    bindings.push({
      event: "UPDATE",
      schema: "public",
      table: "notifications",
      filter: `recipient_id=eq.${input.memberId}`,
      handler: input.onUpdate,
    });
  }

  if (input.onUnreadCountChange) {
    bindings.push(
      {
        event: "UPDATE",
        schema: "public",
        table: "notification_unread_counts",
        filter: `member_id=eq.${input.memberId}`,
        handler: input.onUnreadCountChange,
      },
      {
        event: "INSERT",
        schema: "public",
        table: "notification_unread_counts",
        filter: `member_id=eq.${input.memberId}`,
        handler: input.onUnreadCountChange,
      },
    );
  }

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `notifications:${input.memberId}`,
    onConnectionChange: input.onConnectionChange,
    bindings,
  });
}

export function subscribeOperatorVisitorContext(input: {
  workspaceId: string;
  visitorSessionId: string;
  contactId?: string | null;
  onChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  const bindings: Array<{
    event: "INSERT" | "UPDATE";
    schema: string;
    table: string;
    filter: string;
    handler: (payload: Record<string, unknown>) => void;
  }> = [
    {
      event: "UPDATE",
      schema: "public",
      table: "visitor_sessions",
      filter: `id=eq.${input.visitorSessionId}`,
      handler: input.onChange,
    },
  ];

  if (input.contactId) {
    bindings.push({
      event: "UPDATE",
      schema: "public",
      table: "contacts",
      filter: `id=eq.${input.contactId}`,
      handler: input.onChange,
    });
  }

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `visitor-context:${input.visitorSessionId}`,
    onConnectionChange: input.onConnectionChange,
    bindings,
  });
}

/**
 * Live customer timeline inserts for a contact (operator sidebar).
 * Durable DB rows remain source of truth; reconnect should re-fetch via RPC.
 */
export function subscribeOperatorCustomerTimeline(input: {
  workspaceId: string;
  contactId: string;
  onInsert: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `customer-timeline:${input.contactId}`,
    onConnectionChange: input.onConnectionChange,
    bindings: [
      {
        event: "INSERT",
        schema: "public",
        table: "customer_timeline_events",
        filter: `contact_id=eq.${input.contactId}`,
        handler: input.onInsert,
      },
    ],
  });
}

/**
 * Contact profile CDC: identity updates, tag assignments, and custom field
 * values. Company link changes surface via contacts.company_id UPDATE.
 * Consumers should refetch get_contact_profile on change / reconnect.
 */
export function subscribeOperatorContactProfile(input: {
  workspaceId: string;
  contactId: string;
  onChange: (payload: Record<string, unknown>) => void;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  const supabase = createClient();

  return subscribeWithOperatorAuth({
    supabase,
    channelName: `contact-profile:${input.contactId}`,
    onConnectionChange: input.onConnectionChange,
    bindings: [
      {
        event: "UPDATE",
        schema: "public",
        table: "contacts",
        filter: `id=eq.${input.contactId}`,
        handler: input.onChange,
      },
      {
        event: "INSERT",
        schema: "public",
        table: "contact_tag_assignments",
        filter: `contact_id=eq.${input.contactId}`,
        handler: input.onChange,
      },
      {
        event: "DELETE",
        schema: "public",
        table: "contact_tag_assignments",
        filter: `contact_id=eq.${input.contactId}`,
        handler: input.onChange,
      },
      {
        event: "INSERT",
        schema: "public",
        table: "custom_field_values",
        filter: `contact_id=eq.${input.contactId}`,
        handler: input.onChange,
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "custom_field_values",
        filter: `contact_id=eq.${input.contactId}`,
        handler: input.onChange,
      },
      {
        event: "DELETE",
        schema: "public",
        table: "custom_field_values",
        filter: `contact_id=eq.${input.contactId}`,
        handler: input.onChange,
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
