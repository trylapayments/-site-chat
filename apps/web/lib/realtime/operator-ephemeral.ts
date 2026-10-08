"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  RECEIPT_BROADCAST_EVENT,
  TYPING_BROADCAST_EVENT,
  TYPING_IDLE_STOP_MS,
  applyRemoteReceiptEvent,
  applyRemoteTypingEvent,
  buildPresenceStatePayload,
  buildReceiptBroadcastPayload,
  buildTypingBroadcastPayload,
  decideLocalTypingEmit,
  expireRemoteTypingActors,
  isAnyoneTyping,
  isRoleOnline,
  operatorEphemeralActorKey,
  parseReceiptBroadcastPayload,
  parseTypingBroadcastPayload,
  reconcilePresencePeers,
  sanitizePublicDisplayName,
  type PresencePeer,
  type ReceiptCursors,
  type ReceiptKind,
  type RemoteTypingActor,
} from "@site-chat/shared";

import { createClient } from "@/lib/supabase/client";

export type OperatorTypingIndicator = {
  active: boolean;
};

export type OperatorVisitorPresence = {
  online: boolean;
};

export type OperatorEphemeralCallbacks = {
  onVisitorTyping: (indicator: OperatorTypingIndicator) => void;
  onVisitorPresence: (presence: OperatorVisitorPresence) => void;
  onVisitorReceipts?: (cursors: ReceiptCursors) => void;
  onConnectionChange?: (
    status:
      "connecting" | "connected" | "reconnecting" | "disconnected" | "failed",
  ) => void;
};

export type OperatorEphemeralController = {
  notifyComposerChange: (text: string) => void;
  clearLocalTyping: () => void;
  broadcastReceipt: (input: {
    kind: ReceiptKind;
    lastDeliveredSequence: number;
    lastReadSequence: number;
  }) => void;
  unsubscribe: () => void;
};

type PendingReceiptBroadcast = {
  kind: ReceiptKind;
  lastDeliveredSequence: number;
  lastReadSequence: number;
};

type OperatorSupabaseClient = ReturnType<typeof createClient>;

/** True when RealtimeChannel will reject new presence/postgres_changes handlers. */
export function channelRejectsPresenceCallbacks(
  candidate: Pick<RealtimeChannel, "state" | "joinedOnce">,
): boolean {
  return (
    candidate.joinedOnce ||
    candidate.state === "joined" ||
    candidate.state === "joining"
  );
}

/**
 * Match a client channel to the logical ephemeral topic name passed to
 * `supabase.channel(name)`. The client stores topics as `realtime:<name>`.
 */
export function channelMatchesEphemeralTopic(
  channelTopic: string,
  ephemeralTopic: string,
): boolean {
  if (!ephemeralTopic) {
    return false;
  }
  return (
    channelTopic === ephemeralTopic ||
    channelTopic === `realtime:${ephemeralTopic}` ||
    channelTopic.endsWith(`:${ephemeralTopic}`)
  );
}

async function removeEphemeralTopicChannels(
  supabase: OperatorSupabaseClient,
  ephemeralTopic: string,
): Promise<void> {
  const existing = supabase
    .getChannels()
    .filter((candidate) =>
      channelMatchesEphemeralTopic(candidate.topic, ephemeralTopic),
    );

  await Promise.all(
    existing.map(async (candidate) => {
      try {
        await supabase.removeChannel(candidate);
      } catch {
        // Best-effort cleanup before creating a fresh channel.
      }
    }),
  );
}

/**
 * Subscribe to private ephemeral topic for typing Broadcast + Presence + receipts.
 * Does not replace CDC message subscriptions.
 *
 * Lifecycle rules (Supabase Realtime):
 * - All `.on("presence", …)` handlers MUST be attached before `.subscribe()`.
 * - `supabase.channel(sameName)` returns an existing channel; binding presence
 *   on a joining/joined channel throws. Always remove matching channels first
 *   and serialize start attempts so auth refresh / reconnect cannot race.
 */
export function subscribeOperatorConversationEphemeral(input: {
  ephemeralTopic: string;
  memberId: string;
  displayLabel?: string | null;
  initialVisitorReceipts?: ReceiptCursors;
  onVisitorTyping: (indicator: OperatorTypingIndicator) => void;
  onVisitorPresence: (presence: OperatorVisitorPresence) => void;
  onVisitorReceipts?: (cursors: ReceiptCursors) => void;
  onConnectionChange?: OperatorEphemeralCallbacks["onConnectionChange"];
  /** Fired once the ephemeral channel is SUBSCRIBED (including reconnect). */
  onSubscribed?: () => void;
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
  let pendingReceipt: PendingReceiptBroadcast | null = null;
  let appliedAuthToken: string | null = null;
  let visitorReceipts: ReceiptCursors = input.initialVisitorReceipts ?? {
    lastDeliveredSequence: 0,
    lastReadSequence: 0,
  };
  let lastVisitorOnline: boolean | null = null;
  let lastVisitorTyping: boolean | null = null;
  let currentStatus:
    "connecting" | "connected" | "reconnecting" | "disconnected" | "failed" =
    "connecting";

  // Subscription incarnation id — bump only when creating/replacing a channel
  // (or disposing). Same-token no-ops must preserve the live generation.
  let subscriptionGeneration = 0;
  let startQueue: Promise<void> = Promise.resolve();

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
    const activeTyping = isAnyoneTyping(remoteTyping, "visitor");
    if (lastVisitorTyping === activeTyping) {
      return;
    }
    lastVisitorTyping = activeTyping;
    input.onVisitorTyping({ active: activeTyping });
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

  function handleReceiptBroadcast(raw: unknown) {
    const parsed = parseReceiptBroadcastPayload(raw);
    if (!parsed) {
      return;
    }

    const applied = applyRemoteReceiptEvent({
      cursors: visitorReceipts,
      payload: parsed,
      localActorKey: actorKey,
      expectedRole: "visitor",
    });

    if (!applied.advanced) {
      return;
    }

    visitorReceipts = applied.cursors;
    input.onVisitorReceipts?.(visitorReceipts);
  }

  function queuePendingReceipt(inputReceipt: PendingReceiptBroadcast) {
    if (!pendingReceipt) {
      pendingReceipt = inputReceipt;
      return;
    }

    // Keep the latest watermarks; prefer "read" when either side advances read.
    pendingReceipt = {
      kind:
        inputReceipt.kind === "read" || pendingReceipt.kind === "read"
          ? "read"
          : "delivered",
      lastDeliveredSequence: Math.max(
        pendingReceipt.lastDeliveredSequence,
        inputReceipt.lastDeliveredSequence,
      ),
      lastReadSequence: Math.max(
        pendingReceipt.lastReadSequence,
        inputReceipt.lastReadSequence,
      ),
    };
  }

  async function broadcastReceipt(inputReceipt: {
    kind: ReceiptKind;
    lastDeliveredSequence: number;
    lastReadSequence: number;
  }) {
    if (!channel || currentStatus !== "connected") {
      queuePendingReceipt(inputReceipt);
      return;
    }

    const payload = buildReceiptBroadcastPayload({
      actorRole: "operator",
      actorKey,
      kind: inputReceipt.kind,
      lastDeliveredSequence: inputReceipt.lastDeliveredSequence,
      lastReadSequence: inputReceipt.lastReadSequence,
    });

    try {
      await channel.send({
        type: "broadcast",
        event: RECEIPT_BROADCAST_EVENT,
        payload,
      });
    } catch {
      // Ephemeral — durable cursor already persisted via RPC. Retry on reconnect.
      queuePendingReceipt(inputReceipt);
    }
  }

  async function flushPendingReceipt() {
    if (!pendingReceipt || !channel || currentStatus !== "connected") {
      return;
    }

    const next = pendingReceipt;
    pendingReceipt = null;
    await broadcastReceipt(next);
  }

  function emitPresence() {
    if (!channel) {
      if (lastVisitorOnline !== false) {
        lastVisitorOnline = false;
        input.onVisitorPresence({ online: false });
      }
      return;
    }

    const peers: PresencePeer[] = reconcilePresencePeers(
      channel.presenceState(),
    );
    const online = isRoleOnline(peers, "visitor");
    if (lastVisitorOnline === online) {
      return;
    }
    lastVisitorOnline = online;
    input.onVisitorPresence({ online });
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
        enqueueStart(true);
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
      void flushPendingReceipt();
      input.onSubscribed?.();
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      channel = null;
      presenceTracked = false;
      clearRemoteTyping();
      if (lastVisitorOnline !== false) {
        lastVisitorOnline = false;
        input.onVisitorPresence({ online: false });
      }
      setStatus("reconnecting");
      void supabase.removeChannel(source);
      scheduleResubscribe();
      return;
    }

    if (status === "CLOSED") {
      channel = null;
      presenceTracked = false;
      clearRemoteTyping();
      if (lastVisitorOnline !== false) {
        lastVisitorOnline = false;
        input.onVisitorPresence({ online: false });
      }
      if (active) {
        setStatus("reconnecting");
        scheduleResubscribe();
      }
    }
  }

  function enqueueStart(force = false): void {
    const run = () => startSubscriptionLocked(force);
    startQueue = startQueue.then(run, run);
  }

  /**
   * Start or replace the ephemeral subscription.
   *
   * `subscriptionGeneration` is a subscription *incarnation* id — advanced only
   * when we actually create/replace a channel (or dispose). Same-token no-ops
   * must not bump it, or a still-joining channel's SUBSCRIBED callback is
   * orphaned and receipts stay queued forever.
   */
  async function startSubscriptionLocked(force = false) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!isActive()) {
      return;
    }

    // Private ephemeral topics are RLS-gated; wait for auth before joining.
    if (!session?.access_token) {
      return;
    }

    await supabase.realtime.setAuth(session.access_token);
    if (!isActive()) {
      return;
    }

    // Same token + live/joining channel: setAuth is enough. Do not clear retry
    // timers, bump generation, or replace the channel — INITIAL_SESSION /
    // TOKEN_REFRESHED with an identical token must not orphan SUBSCRIBED.
    if (
      !force &&
      appliedAuthToken === session.access_token &&
      channel &&
      (currentStatus === "connected" || currentStatus === "connecting")
    ) {
      return;
    }

    // Real replace/create: invalidate the prior incarnation, then build a new one.
    clearRetryTimer();
    const generation = ++subscriptionGeneration;

    appliedAuthToken = session.access_token;

    if (channel) {
      channel = null;
      presenceTracked = false;
      if (currentStatus === "connected") {
        setStatus("reconnecting");
      }
    }

    // Critical: supabase.channel(name) reuses an existing topic. If a prior
    // subscribe is still joining/joined, attaching presence handlers throws.
    await removeEphemeralTopicChannels(supabase, input.ephemeralTopic);
    if (!isActive() || generation !== subscriptionGeneration) {
      return;
    }

    setStatus(retryAttempt > 0 ? "reconnecting" : "connecting");

    const nextChannel = supabase.channel(input.ephemeralTopic, {
      config: {
        private: true,
        presence: {
          key: actorKey,
        },
      },
    });

    if (channelRejectsPresenceCallbacks(nextChannel)) {
      // Still not fully removed — force cleanup and retry instead of binding.
      await supabase.removeChannel(nextChannel);
      if (isActive() && generation === subscriptionGeneration) {
        scheduleResubscribe();
      }
      return;
    }

    // Bind broadcast + presence BEFORE subscribe() — required by Realtime.
    nextChannel
      .on("broadcast", { event: TYPING_BROADCAST_EVENT }, (payload) => {
        if (channel !== nextChannel) {
          return;
        }
        handleTypingBroadcast(payload.payload);
      })
      .on("broadcast", { event: RECEIPT_BROADCAST_EVENT }, (payload) => {
        if (channel !== nextChannel) {
          return;
        }
        handleReceiptBroadcast(payload.payload);
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

    if (!isActive() || generation !== subscriptionGeneration) {
      void supabase.removeChannel(nextChannel);
      return;
    }

    channel = nextChannel;
    nextChannel.subscribe((status) => {
      if (generation !== subscriptionGeneration) {
        return;
      }
      handleChannelStatus(status, nextChannel);
    });
  }

  enqueueStart(false);

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
      // Serialized: only recreates the channel when the access token changes.
      enqueueStart(false);
    })();
  });

  return {
    notifyComposerChange,
    clearLocalTyping,
    broadcastReceipt: (receipt) => {
      void broadcastReceipt(receipt);
    },
    unsubscribe: () => {
      active = false;
      subscriptionGeneration += 1;
      clearRetryTimer();
      authSubscription.unsubscribe();
      clearTypingIdleTimer();
      stopTypingExpiryLoop();
      void emitTypingStopped();
      clearRemoteTyping();
      if (lastVisitorOnline !== false) {
        lastVisitorOnline = false;
        input.onVisitorPresence({ online: false });
      }

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
      } else {
        void removeEphemeralTopicChannels(supabase, input.ephemeralTopic);
      }
    },
  };
}
