"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  TYPING_BROADCAST_EVENT,
  TYPING_IDLE_STOP_MS,
  applyRemoteTypingEvent,
  buildPresenceStatePayload,
  buildTypingBroadcastPayload,
  decideLocalTypingEmit,
  expireRemoteTypingActors,
  isAnyoneTyping,
  isRoleOnline,
  operatorEphemeralActorKey,
  parseTypingBroadcastPayload,
  reconcilePresencePeers,
  sanitizePublicDisplayName,
  type PresencePeer,
  type RemoteTypingActor,
} from "@site-chat/shared";

import { createClient } from "@/lib/supabase/client";

type OperatorSupabaseClient = ReturnType<typeof createClient>;

export type OperatorTypingIndicator = {
  active: boolean;
};

export type OperatorVisitorPresence = {
  online: boolean;
};

export type OperatorEphemeralCallbacks = {
  onVisitorTyping: (indicator: OperatorTypingIndicator) => void;
  onVisitorPresence: (presence: OperatorVisitorPresence) => void;
  onConnectionChange?: (
    status:
      "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
  ) => void;
};

export type OperatorEphemeralController = {
  notifyComposerChange: (text: string) => void;
  clearLocalTyping: () => void;
  unsubscribe: () => void;
};

async function applyOperatorRealtimeAuth(
  supabase: OperatorSupabaseClient,
): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return false;
  }

  await supabase.realtime.setAuth(session.access_token);
  return true;
}

/**
 * Subscribe to private ephemeral topic for typing Broadcast + Presence.
 * Does not replace CDC message subscriptions.
 */
export function subscribeOperatorConversationEphemeral(input: {
  ephemeralTopic: string;
  memberId: string;
  displayLabel?: string | null;
  onVisitorTyping: (indicator: OperatorTypingIndicator) => void;
  onVisitorPresence: (presence: OperatorVisitorPresence) => void;
  onConnectionChange?: OperatorEphemeralCallbacks["onConnectionChange"];
}): OperatorEphemeralController {
  const supabase = createClient();
  const actorKey = operatorEphemeralActorKey(input.memberId);
  const safeDisplayName = sanitizePublicDisplayName(input.displayLabel ?? null);

  let channel: RealtimeChannel | null = null;
  let active = true;
  const isActive = () => active;
  let remoteTyping = new Map<string, RemoteTypingActor>();
  let typingExpiryTimer: ReturnType<typeof setInterval> | null = null;
  let localTyping = false;
  let lastTypingStartedAt: number | null = null;
  let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let presenceTracked = false;
  let currentStatus:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed" =
    "connecting";

  input.onConnectionChange?.(currentStatus);

  function setStatus(
    next:
      "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
  ) {
    if (next === currentStatus) {
      return;
    }
    currentStatus = next;
    input.onConnectionChange?.(next);
  }

  function emitVisitorTyping() {
    input.onVisitorTyping({
      active: isAnyoneTyping(remoteTyping, "visitor"),
    });
  }

  function clearRemoteTyping() {
    remoteTyping = new Map();
    emitVisitorTyping();
  }

  function stopTypingExpiryLoop() {
    if (typingExpiryTimer !== null) {
      clearInterval(typingExpiryTimer);
      typingExpiryTimer = null;
    }
  }

  function ensureTypingExpiryLoop() {
    if (typingExpiryTimer !== null) {
      return;
    }

    typingExpiryTimer = setInterval(() => {
      const { actors, changed } = expireRemoteTypingActors({
        actors: remoteTyping,
        nowMs: Date.now(),
      });
      if (!changed) {
        if (actors.size === 0) {
          stopTypingExpiryLoop();
        }
        return;
      }
      remoteTyping = actors;
      emitVisitorTyping();
      if (actors.size === 0) {
        stopTypingExpiryLoop();
      }
    }, 500);
  }

  function handleTypingBroadcast(raw: unknown) {
    const parsed = parseTypingBroadcastPayload(raw);
    if (!parsed || parsed.actorRole !== "visitor") {
      return;
    }

    remoteTyping = applyRemoteTypingEvent({
      actors: remoteTyping,
      payload: parsed,
      nowMs: Date.now(),
      localActorKey: actorKey,
    });
    emitVisitorTyping();
    ensureTypingExpiryLoop();
  }

  function emitPresence() {
    if (!channel) {
      input.onVisitorPresence({ online: false });
      return;
    }

    const peers: PresencePeer[] = reconcilePresencePeers(
      channel.presenceState(),
    );
    input.onVisitorPresence({
      online: isRoleOnline(peers, "visitor"),
    });
  }

  async function trackPresence() {
    if (!channel || presenceTracked) {
      return;
    }

    try {
      await channel.track(
        buildPresenceStatePayload({
          role: "operator",
          displayName: safeDisplayName,
        }),
      );
      presenceTracked = true;
    } catch {
      presenceTracked = false;
    }
  }

  async function broadcastTyping(state: "started" | "stopped") {
    if (!channel) {
      return;
    }

    const payload = buildTypingBroadcastPayload({
      actorRole: "operator",
      actorKey,
      state,
      displayName: safeDisplayName,
    });

    try {
      await channel.send({
        type: "broadcast",
        event: TYPING_BROADCAST_EVENT,
        payload,
      });
    } catch {
      // Ephemeral
    }
  }

  async function emitTypingStopped() {
    if (!localTyping) {
      lastTypingStartedAt = null;
      return;
    }
    localTyping = false;
    lastTypingStartedAt = null;
    await broadcastTyping("stopped");
  }

  function clearTypingIdleTimer() {
    if (typingIdleTimer !== null) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
  }

  function armTypingIdleTimer() {
    clearTypingIdleTimer();
    typingIdleTimer = setTimeout(() => {
      typingIdleTimer = null;
      void emitTypingStopped();
    }, TYPING_IDLE_STOP_MS);
  }

  function notifyComposerChange(text: string) {
    if (!active || !channel) {
      return;
    }

    const nowMs = Date.now();
    const decision = decideLocalTypingEmit({
      text,
      nowMs,
      lastStartedAt: lastTypingStartedAt,
      isCurrentlyTyping: localTyping,
    });

    if (decision.action === "started") {
      localTyping = true;
      lastTypingStartedAt = nowMs;
      void broadcastTyping("started");
      armTypingIdleTimer();
      return;
    }

    if (decision.action === "stopped") {
      clearTypingIdleTimer();
      void emitTypingStopped();
      return;
    }

    // Meaningful input while already typing (throttled): keep idle clock fresh.
    if (text.trim().length > 0 && localTyping) {
      armTypingIdleTimer();
    }
  }

  function clearLocalTyping() {
    clearTypingIdleTimer();
    void emitTypingStopped();
  }

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;

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
    setStatus("reconnecting");
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (active) {
        void startSubscription();
      }
    }, delayMs);
  }

  function handleChannelStatus(status: string, source: RealtimeChannel) {
    if (channel !== source) {
      return;
    }

    if (status === "SUBSCRIBED") {
      retryAttempt = 0;
      setStatus("connected");
      void trackPresence();
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      channel = null;
      presenceTracked = false;
      clearRemoteTyping();
      input.onVisitorPresence({ online: false });
      setStatus("reconnecting");
      void supabase.removeChannel(source);
      scheduleResubscribe();
      return;
    }

    if (status === "CLOSED") {
      channel = null;
      presenceTracked = false;
      clearRemoteTyping();
      input.onVisitorPresence({ online: false });
      if (active) {
        setStatus("reconnecting");
        scheduleResubscribe();
      }
    }
  }

  async function startSubscription() {
    clearRetryTimer();
    const authed = await applyOperatorRealtimeAuth(supabase);
    if (!isActive()) {
      return;
    }

    // Private ephemeral topics are RLS-gated; wait for auth before joining.
    if (!authed) {
      return;
    }

    if (channel) {
      const previous = channel;
      channel = null;
      presenceTracked = false;
      if (currentStatus === "connected") {
        setStatus("reconnecting");
      }
      await supabase.removeChannel(previous);
      if (!isActive()) {
        return;
      }
    }

    setStatus(retryAttempt > 0 ? "reconnecting" : "connecting");

    const nextChannel = supabase
      .channel(input.ephemeralTopic, {
        config: {
          private: true,
          presence: {
            key: actorKey,
          },
        },
      })
      .on("broadcast", { event: TYPING_BROADCAST_EVENT }, (payload) => {
        if (channel !== nextChannel) {
          return;
        }
        handleTypingBroadcast(payload.payload);
      })
      .on("presence", { event: "sync" }, () => {
        if (channel !== nextChannel) {
          return;
        }
        emitPresence();
      })
      .on("presence", { event: "join" }, () => {
        if (channel !== nextChannel) {
          return;
        }
        emitPresence();
      })
      .on("presence", { event: "leave" }, () => {
        if (channel !== nextChannel) {
          return;
        }
        emitPresence();
      });

    channel = nextChannel;
    nextChannel.subscribe((status) => {
      handleChannelStatus(status, nextChannel);
    });
  }

  void startSubscription();

  const {
    data: { subscription: authSubscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.access_token) {
      return;
    }

    void (async () => {
      await supabase.realtime.setAuth(session.access_token);
      if (!active) {
        return;
      }
      // Resubscribe so Presence/Broadcast bindings are authorized after auth.
      void startSubscription();
    })();
  });

  return {
    notifyComposerChange,
    clearLocalTyping,
    unsubscribe: () => {
      active = false;
      clearRetryTimer();
      authSubscription.unsubscribe();
      clearTypingIdleTimer();
      stopTypingExpiryLoop();
      void emitTypingStopped();
      clearRemoteTyping();
      input.onVisitorPresence({ online: false });

      if (channel) {
        const current = channel;
        channel = null;
        presenceTracked = false;
        void (async () => {
          try {
            await current.untrack();
          } catch {
            // ignore
          }
          await supabase.removeChannel(current);
        })();
      }
    },
  };
}
