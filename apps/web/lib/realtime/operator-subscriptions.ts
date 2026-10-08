"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { realtimeRetryDelay } from "./retry-delay";
import { createClient } from "@/lib/supabase/client";

type OperatorSupabaseClient = ReturnType<typeof createClient>;
// A fixed private topic must finish leaving before the SDK can rejoin it.
const pendingBroadcastRemoval = new Map<string, Promise<void>>();

export type RealtimeConnectionListener = (
  status:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
) => void;

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
  broadcastTopic?: string;
  onConnectionChange?: RealtimeConnectionListener;
}): () => void {
  let currentStatus: RealtimeConnectionListener extends (
    status: infer S,
  ) => void
    ? S
    : never = "connecting";
  let channel: RealtimeChannel | null = null;
  let active = true;
  const isActive = () => active;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let channelEpoch = 0;
  let appliedAuthToken: string | null = null;
  let startQueue: Promise<void> = Promise.resolve();

  input.onConnectionChange?.(currentStatus);

  function isLiveSameToken(token: string): boolean {
    return (
      appliedAuthToken === token &&
      channel !== null &&
      (currentStatus === "connected" || currentStatus === "connecting")
    );
  }

  function enqueueStart() {
    const run = () =>
      startSubscription().catch(() => {
        if (!isActive()) return;
        retireChannel();
        currentStatus = "failed";
        input.onConnectionChange?.(currentStatus);
        scheduleResubscribe();
      });
    startQueue = startQueue.then(run, run);
  }

  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function clearJoinTimer() {
    if (joinTimer !== null) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
  }

  function retireChannel() {
    clearJoinTimer();
    // Invalidate callbacks before removal: CLOSED can fire during removal,
    // and a late SUBSCRIBED must not mark a retired attempt as connected.
    channelEpoch += 1;
    const previous = channel;
    channel = null;
    if (previous) {
      const removal = input.supabase
        .removeChannel(previous)
        .then(() => undefined);
      if (input.broadcastTopic) {
        const topic = input.broadcastTopic;
        pendingBroadcastRemoval.set(topic, removal);
        void removal
          .finally(() => {
            if (pendingBroadcastRemoval.get(topic) === removal)
              pendingBroadcastRemoval.delete(topic);
          })
          .catch(() => undefined);
      }
      void removal.catch(() => undefined);
    }
  }

  function scheduleResubscribe() {
    if (!isActive() || retryTimer !== null) {
      return;
    }
    const delayMs = realtimeRetryDelay(retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isActive()) {
        enqueueStart();
      }
    }, delayMs);
  }

  async function startSubscription() {
    clearRetryTimer();
    const {
      data: { session },
    } = await input.supabase.auth.getSession();
    if (!isActive()) {
      return;
    }

    // postgres_changes is RLS-filtered; subscribing before setAuth reports
    // SUBSCRIBED but delivers no rows. Wait for onAuthStateChange instead.
    const token = session?.access_token ?? null;
    if (!token) {
      return;
    }

    // Same token + live/joining channel: do not replace and do not setAuth
    // again. A second setAuth can abort an in-flight postgres_changes join
    // and leave the UI stuck at connecting (assignment/receipts E2E).
    // INITIAL_SESSION / TOKEN_REFRESHED must not orphan SUBSCRIBED or flip
    // connected→reconnecting (that jerks an idle Inbox via router.refresh).
    if (isLiveSameToken(token)) {
      return;
    }

    await input.supabase.realtime.setAuth(token);
    if (!isActive()) {
      return;
    }

    appliedAuthToken = token;

    if (channel) {
      retireChannel();
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
    const topic =
      input.broadcastTopic ??
      `${input.channelName}:${String(epoch)}:${Math.random().toString(36).slice(2, 8)}`;
    if (input.broadcastTopic) {
      await pendingBroadcastRemoval.get(topic);
      if (!isActive() || epoch !== channelEpoch) return;
    }
    let nextChannel = input.supabase.channel(
      topic,
      input.broadcastTopic ? { config: { private: true } } : undefined,
    );
    if (input.broadcastTopic) {
      nextChannel = nextChannel.on(
        "broadcast",
        { event: "message.created" },
        (envelope) => {
          if (!isActive() || epoch !== channelEpoch) return;
          const payload: unknown = envelope.payload;
          if (!payload || typeof payload !== "object" || Array.isArray(payload))
            return;
          const row = payload as Record<string, unknown>;
          if (row.is_internal !== false) return;
          input.bindings[0]?.handler(row);
        },
      );
    }
    for (const binding of input.broadcastTopic ? [] : input.bindings) {
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

    // SDK failures normally trigger recovery. Bound a silent join as well,
    // without polling or replacing healthy subscriptions.
    joinTimer = setTimeout(() => {
      if (!isActive() || epoch !== channelEpoch) return;
      retireChannel();
      currentStatus = "failed";
      input.onConnectionChange?.(currentStatus);
      scheduleResubscribe();
    }, 30_000);

    channel = nextChannel;
    nextChannel.subscribe((status) => {
      if (!isActive() || epoch !== channelEpoch) {
        return;
      }

      const next = mapChannelStatus(status, currentStatus);

      if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
      ) {
        retireChannel();
        if (next !== currentStatus) {
          currentStatus = next;
          input.onConnectionChange?.(next);
        }
        scheduleResubscribe();
        return;
      }

      if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
        retireChannel();
        if (next !== currentStatus) {
          currentStatus = next;
          input.onConnectionChange?.(next);
        }
        scheduleResubscribe();
        return;
      }

      // Remaining subscribe callback status is SUBSCRIBED.
      clearJoinTimer();
      retryAttempt = 0;
      if (next !== currentStatus) {
        currentStatus = next;
        input.onConnectionChange?.(next);
      }
    });
  }

  enqueueStart();

  const {
    data: { subscription: authSubscription },
  } = input.supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.access_token) {
      return;
    }

    // Do not setAuth here. A second setAuth while postgres_changes is still
    // joining can abort the handshake and leave status stuck at "connecting".
    // startSubscription applies auth and no-ops when the token is unchanged.
    if (!isLiveSameToken(session.access_token)) {
      enqueueStart();
    }
  });

  return () => {
    active = false;
    clearRetryTimer();
    retireChannel();
    authSubscription.unsubscribe();
  };
}

// One workspace message channel is shared by the inbox, badge and open thread.
// Enable only after the database migration and private-channel checks pass.
const messagePools = new Map<
  string,
  {
    listeners: Set<{
      message: (row: Record<string, unknown>) => void;
      status?: RealtimeConnectionListener;
    }>;
    stop: () => void;
    status: Parameters<RealtimeConnectionListener>[0];
  }
>();
function subscribePublicMessages(
  workspaceId: string,
  message: (row: Record<string, unknown>) => void,
  status?: RealtimeConnectionListener,
): () => void {
  const listener = { message, status };
  let pool = messagePools.get(workspaceId);
  if (!pool) {
    pool = { listeners: new Set(), stop: () => {}, status: "connecting" };
    messagePools.set(workspaceId, pool);
    const shared = pool;
    const seen = new Set<string>();
    shared.stop = subscribeWithOperatorAuth({
      supabase: createClient(),
      channelName: `operator-messages:${workspaceId}`,
      broadcastTopic: `operator-messages:${workspaceId}`,
      bindings: [
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: "",
          handler: (row) => {
            if (row.workspace_id !== workspaceId || typeof row.id !== "string")
              return;
            if (seen.has(row.id)) return;
            seen.add(row.id);
            if (seen.size > 2048) {
              const oldest = seen.values().next().value;
              if (oldest) seen.delete(oldest);
            }
            for (const target of shared.listeners) target.message(row);
          },
        },
      ],
      onConnectionChange: (next) => {
        shared.status = next;
        for (const target of shared.listeners) target.status?.(next);
      },
    });
  }
  pool.listeners.add(listener);
  status?.(pool.status);
  const shared = pool;
  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size === 0) {
      shared.stop();
      if (messagePools.get(workspaceId) === shared)
        messagePools.delete(workspaceId);
    }
  };
}

function combinedConnection(listener?: RealtimeConnectionListener) {
  type Status = Parameters<RealtimeConnectionListener>[0];
  const states: Status[] = ["connecting", "connecting"];
  let previous: Status | undefined;
  return [0, 1].map((index) => (status: Status) => {
    states[index] = status;
    const next = states.every((state) => state === "connected")
      ? "connected"
      : (states.find(
          (state) => state === "failed" || state === "disconnected",
        ) ??
        states.find((state) => state !== "connected") ??
        "connecting");
    if (next !== previous) {
      previous = next;
      listener?.(next);
    }
  });
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

  const broadcast = process.env.NEXT_PUBLIC_OPERATOR_BROADCAST === "true";
  const [messageStatus, changeStatus] = combinedConnection(
    input.onConnectionChange,
  );
  const stopMessages = broadcast
    ? subscribePublicMessages(
        input.workspaceId,
        (row) => {
          input.onMessageInsert(row);
        },
        messageStatus,
      )
    : () => {};
  const stopChanges = subscribeWithOperatorAuth({
    supabase,
    channelName: `workspace:${input.workspaceId}:inbox`,
    onConnectionChange: broadcast ? changeStatus : input.onConnectionChange,
    bindings: broadcast
      ? bindings.filter((binding) => binding.table !== "messages")
      : bindings,
  });
  return () => {
    stopMessages();
    stopChanges();
  };
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

  const broadcast = process.env.NEXT_PUBLIC_OPERATOR_BROADCAST === "true";
  const [messageStatus, changeStatus] = combinedConnection(
    input.onConnectionChange,
  );
  const stopMessages = broadcast
    ? subscribePublicMessages(
        input.workspaceId,
        (row) => {
          if (row.conversation_id !== input.conversationId) return;
          input.onMessageInsert(row);
        },
        messageStatus,
      )
    : () => {};
  const stopChanges = subscribeWithOperatorAuth({
    supabase,
    channelName: `conversation:${input.conversationId}`,
    onConnectionChange: broadcast ? changeStatus : input.onConnectionChange,
    bindings: broadcast
      ? bindings.filter((binding) => binding.table !== "messages")
      : bindings,
  });
  return () => {
    stopMessages();
    stopChanges();
  };
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
