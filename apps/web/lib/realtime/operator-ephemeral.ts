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

async function applyOperatorRealtimeAuth(supabase: OperatorSupabaseClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    await supabase.realtime.setAuth(session.access_token);
  }
}

/**
 * Subscribe to private conversation topic for typing Broadcast + Presence.
 * Does not replace CDC message subscriptions.
 */
export function subscribeOperatorConversationEphemeral(input: {
  realtimeTopic: string;
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

  function handleChannelStatus(status: string) {
    if (status === "SUBSCRIBED") {
      setStatus("connected");
      void trackPresence();
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      presenceTracked = false;
      clearRemoteTyping();
      input.onVisitorPresence({ online: false });
      setStatus(currentStatus === "connected" ? "reconnecting" : "failed");
      return;
    }

    if (status === "CLOSED") {
      presenceTracked = false;
      clearRemoteTyping();
      input.onVisitorPresence({ online: false });
      if (active) {
        setStatus("disconnected");
      }
    }
  }

  async function startSubscription() {
    await applyOperatorRealtimeAuth(supabase);
    if (!active) {
      return;
    }

    channel = supabase
      .channel(input.realtimeTopic, {
        config: {
          private: true,
          presence: {
            key: actorKey,
          },
        },
      })
      .on("broadcast", { event: TYPING_BROADCAST_EVENT }, (payload) => {
        handleTypingBroadcast(payload.payload);
      })
      .on("presence", { event: "sync" }, () => {
        emitPresence();
      })
      .on("presence", { event: "join" }, () => {
        emitPresence();
      })
      .on("presence", { event: "leave" }, () => {
        emitPresence();
      })
      .subscribe((status) => {
        handleChannelStatus(status);
      });
  }

  void startSubscription();

  const {
    data: { subscription: authSubscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.access_token) {
      return;
    }
    void supabase.realtime.setAuth(session.access_token);
  });

  return {
    notifyComposerChange,
    clearLocalTyping,
    unsubscribe: () => {
      active = false;
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
