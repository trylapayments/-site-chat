import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import {
  RECEIPT_BROADCAST_EVENT,
  TYPING_BROADCAST_EVENT,
  TYPING_IDLE_STOP_MS,
  TYPING_REMOTE_TTL_MS,
  applyRemoteReceiptEvent,
  applyRemoteTypingEvent,
  buildPresenceStatePayload,
  buildReceiptBroadcastPayload,
  buildTypingBroadcastPayload,
  decideLocalTypingEmit,
  expireRemoteTypingActors,
  isAnyoneTyping,
  isRoleOnline,
  mergeMessages,
  mergeReceiptCursors,
  parseReceiptBroadcastPayload,
  parseTypingBroadcastPayload,
  reconcilePresencePeers,
  resolveTypingDisplayName,
  toMessageViewFromWidgetBroadcast,
  toMessageViewFromWidgetHttp,
  widgetBroadcastEventSchema,
  type ConnectionState,
  type MessageView,
  type PresencePeer,
  type ReceiptCursors,
  type ReceiptKind,
  type RemoteTypingActor,
} from "@site-chat/shared";

import type { ListMessagesPayload, WidgetApiClient } from "../api/client";
import { maxAgentMessageSequence } from "./receipt-visibility";

declare const __SITECHAT_SUPABASE_URL__: string;
declare const __SITECHAT_SUPABASE_KEY__: string;

export type WidgetTypingIndicator = {
  active: boolean;
  displayName: string | null;
};

export type WidgetPresenceView = {
  operatorsOnline: boolean;
};

export type WidgetTransportCallbacks = {
  onMessages: (messages: MessageView[]) => void;
  onConnectionState: (state: ConnectionState) => void;
  onAgentTyping?: (indicator: WidgetTypingIndicator) => void;
  onPresence?: (presence: WidgetPresenceView) => void;
  /** Peer (operator) receipt cursors for visitor-owned message ticks. */
  onAgentReceipts?: (cursors: ReceiptCursors) => void;
};

type RealtimeCredentials = {
  token: string;
  messageTopic: string;
  ephemeralTopic: string;
  presenceKey: string;
  expiresAt: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

type LifecycleHandlers = {
  onVisible: () => void;
  onOnline: () => void;
  onOffline: () => void;
};

function isRetriableWidgetRealtimeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("session") ||
    message.includes("conversation") ||
    message.includes("forbidden") ||
    message.includes("too many requests")
  );
}

/**
 * Prefer URL/key from the realtime-token response (server env). Fall back to
 * Vite-injected defines only when they are real — never use CI placeholders.
 */
export function resolveWidgetSupabaseConfig(input?: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}): { url: string; key: string } | null {
  const url = (input?.supabaseUrl || __SITECHAT_SUPABASE_URL__ || "").trim();
  const key = (input?.supabaseAnonKey || __SITECHAT_SUPABASE_KEY__ || "").trim();

  if (!url || !key) {
    return null;
  }

  if (url.includes("placeholder.supabase") || key.startsWith("placeholder-")) {
    return null;
  }

  return { url, key };
}

function createTabPresenceSuffix(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class WidgetRealtimeTransport {
  private client: SupabaseClient | null = null;
  private messageChannel: RealtimeChannel | null = null;
  private ephemeralChannel: RealtimeChannel | null = null;
  private messages: MessageView[] = [];
  private tokenExpiresAt = 0;
  private messageTopic = "";
  private ephemeralTopic = "";
  private presenceKey = "";
  /** Stable per transport/tab instance so multi-tab presence does not collide. */
  private readonly tabPresenceSuffix = createTabPresenceSuffix();
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private lifecycle: LifecycleHandlers | null = null;
  private subscribeGeneration = 0;
  private remoteTyping = new Map<string, RemoteTypingActor>();
  private typingExpiryTimer: ReturnType<typeof setInterval> | null = null;
  private localTyping = false;
  private lastTypingStartedAt: number | null = null;
  private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTracked = false;
  private messageSubscribed = false;
  private ephemeralSubscribed = false;
  private embedToken = "";
  private sessionToken = "";
  /** Local visitor cursors — used for monotonic delivered/read writes. */
  private localReceipts: ReceiptCursors = {
    lastDeliveredSequence: 0,
    lastReadSequence: 0,
  };
  /** Operator peer cursors — drive ticks on the visitor's own messages. */
  private agentReceipts: ReceiptCursors = {
    lastDeliveredSequence: 0,
    lastReadSequence: 0,
  };
  private deliveredInFlightThrough = 0;
  private readInFlightThrough = 0;

  constructor(
    private readonly api: WidgetApiClient,
    private readonly callbacks: WidgetTransportCallbacks,
  ) {}

  async start(input: {
    embedToken: string;
    sessionToken: string;
    initialMessages: MessageView[];
    initialAgentReceipts?: ReceiptCursors;
    initialVisitorReceipts?: ReceiptCursors;
  }) {
    this.running = true;
    this.embedToken = input.embedToken;
    this.sessionToken = input.sessionToken;
    this.messages = input.initialMessages;

    if (input.initialAgentReceipts) {
      this.setAgentReceipts(input.initialAgentReceipts);
    }
    if (input.initialVisitorReceipts) {
      this.localReceipts = mergeReceiptCursors(
        this.localReceipts,
        input.initialVisitorReceipts,
      ).next;
    }

    this.callbacks.onMessages(this.messages);

    if (input.initialMessages.length > 0) {
      await this.ensureSubscription(input.embedToken, input.sessionToken);
      // Delivered may advance while the tab is hidden; never auto-mark read here.
      this.markDeliveredThrough(maxAgentMessageSequence(this.messages));
    } else {
      this.callbacks.onConnectionState("connecting");
    }

    this.attachLifecycle(input.embedToken, input.sessionToken);
  }

  stop() {
    this.running = false;
    this.subscribeGeneration += 1;
    this.clearRetryTimer();
    this.clearTypingIdleTimer();
    this.stopTypingExpiryLoop();
    void this.emitTypingStopped();
    this.clearRemoteTyping();
    this.detachLifecycle();
    void this.teardown();
  }

  getMessages() {
    return this.messages;
  }

  getPresenceKey() {
    return this.presenceKey;
  }

  getAgentReceipts(): ReceiptCursors {
    return this.agentReceipts;
  }

  /**
   * Seed / merge durable cursors from HTTP listMessages (source of truth on catch-up).
   */
  applyListReceiptCursors(
    listed: Pick<
      ListMessagesPayload,
      | "agent_last_delivered_sequence"
      | "agent_last_read_sequence"
      | "visitor_last_delivered_sequence"
      | "visitor_last_read_sequence"
    >,
  ) {
    this.setAgentReceipts({
      lastDeliveredSequence: listed.agent_last_delivered_sequence,
      lastReadSequence: listed.agent_last_read_sequence,
    });
    this.localReceipts = mergeReceiptCursors(this.localReceipts, {
      lastDeliveredSequence: listed.visitor_last_delivered_sequence,
      lastReadSequence: listed.visitor_last_read_sequence,
    }).next;
  }

  replaceMessages(messages: MessageView[]) {
    this.messages = messages;
    this.callbacks.onMessages(this.messages);
  }

  mergeIncoming(messages: MessageView[]) {
    this.messages = mergeMessages(this.messages, messages, []);
    this.callbacks.onMessages(this.messages);
  }

  mergePending(pending: MessageView[]) {
    this.messages = mergeMessages(this.messages, [], pending);
    this.callbacks.onMessages(this.messages);
  }

  /**
   * Mark agent messages as read through `sequence` (durable + ephemeral).
   * UI must gate on panel-open + document visible — transport does not.
   */
  markReadThrough(sequence: number) {
    void this.persistReceipt("read", sequence);
  }

  /** Alias for UI: messages currently shown in the open panel are viewed. */
  notifyMessagesVisible(maxAgentSequence: number) {
    this.markReadThrough(maxAgentSequence);
  }

  /**
   * Drive visitor typing broadcasts from composer input.
   * Starts only after meaningful text; throttles; stops on idle/clear.
   */
  notifyComposerChange(text: string) {
    if (!this.running || !this.ephemeralChannel || !this.presenceKey) {
      return;
    }

    const nowMs = Date.now();
    const decision = decideLocalTypingEmit({
      text,
      nowMs,
      lastStartedAt: this.lastTypingStartedAt,
      isCurrentlyTyping: this.localTyping,
    });

    if (decision.action === "started") {
      this.localTyping = true;
      this.lastTypingStartedAt = nowMs;
      void this.broadcastTyping("started");
      this.armTypingIdleTimer();
      return;
    }

    if (decision.action === "stopped") {
      this.clearTypingIdleTimer();
      void this.emitTypingStopped();
      return;
    }

    // Meaningful input while already typing (throttled): keep idle clock fresh.
    if (text.trim().length > 0 && this.localTyping) {
      this.armTypingIdleTimer();
    }
  }

  /** Clear local typing (send, close, session change). */
  clearLocalTyping() {
    this.clearTypingIdleTimer();
    void this.emitTypingStopped();
  }

  async catchUp(input: { embedToken: string; sessionToken: string }) {
    this.embedToken = input.embedToken;
    this.sessionToken = input.sessionToken;

    let afterSequence = this.messages.reduce(
      (max, message) => Math.max(max, message.sequenceNumber),
      0,
    );

    for (let page = 0; page < 20; page += 1) {
      const listed = await this.api.listMessages({
        embedToken: input.embedToken,
        sessionToken: input.sessionToken,
        afterSequence: afterSequence > 0 ? afterSequence : undefined,
      });

      // Durable cursors are authoritative on catch-up (including empty pages).
      this.applyListReceiptCursors(listed);

      if (listed.items.length === 0) {
        break;
      }

      const incoming = listed.items.map((item) => toMessageViewFromWidgetHttp(item));
      this.messages = mergeMessages(this.messages, incoming, []);
      afterSequence = this.messages.reduce(
        (max, message) => Math.max(max, message.sequenceNumber),
        0,
      );

      if (listed.items.length < 50) {
        break;
      }
    }

    this.callbacks.onMessages(this.messages);

    // Catch-up / reconnect: mark delivered for agent messages; never auto-mark read.
    this.markDeliveredThrough(maxAgentMessageSequence(this.messages));
  }

  private attachLifecycle(embedToken: string, sessionToken: string) {
    this.detachLifecycle();

    const onVisible = () => {
      if (document.visibilityState === "visible" && this.running) {
        void this.catchUp({ embedToken, sessionToken });
        void this.ensureSubscription(embedToken, sessionToken);
      }
    };

    const onOnline = () => {
      if (!this.running) {
        return;
      }
      // Stale channel refs can still be non-null after offline; force recreate.
      this.invalidateChannelsForReconnect();
      void this.catchUp({ embedToken, sessionToken });
      void this.ensureSubscription(embedToken, sessionToken);
    };

    const onOffline = () => {
      if (this.running) {
        void this.emitTypingStopped();
        this.clearRemoteTyping();
        this.invalidateChannelsForReconnect();
        this.callbacks.onConnectionState("disconnected");
        this.callbacks.onPresence?.({ operatorsOnline: false });
      }
    };

    this.lifecycle = { onVisible, onOnline, onOffline };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  private detachLifecycle() {
    if (!this.lifecycle) {
      return;
    }

    document.removeEventListener("visibilitychange", this.lifecycle.onVisible);
    window.removeEventListener("online", this.lifecycle.onOnline);
    window.removeEventListener("offline", this.lifecycle.onOffline);
    this.lifecycle = null;
  }

  async ensureLiveConnection(input: { embedToken: string; sessionToken: string }) {
    await this.ensureSubscription(input.embedToken, input.sessionToken);
  }

  private scheduleSubscriptionRetry(embedToken: string, sessionToken: string) {
    if (!this.running || this.retryTimer !== null) {
      return;
    }

    const delayMs = Math.min(1_000 * 2 ** this.retryAttempt, 15_000);
    this.retryAttempt += 1;
    this.callbacks.onConnectionState("reconnecting");

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) {
        void this.ensureSubscription(embedToken, sessionToken);
      }
    }, delayMs);
  }

  private clearRetryTimer() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private isSubscriptionCurrent(generation: number): boolean {
    return this.running && generation === this.subscribeGeneration;
  }

  /**
   * Drop live channel refs so the next ensureSubscription recreates them.
   * Keeps the Supabase client + minted token when still valid.
   */
  private invalidateChannelsForReconnect() {
    this.clearRetryTimer();
    this.messageSubscribed = false;
    this.ephemeralSubscribed = false;
    this.presenceTracked = false;

    const message = this.messageChannel;
    const ephemeral = this.ephemeralChannel;
    this.messageChannel = null;
    this.ephemeralChannel = null;

    if (this.client) {
      if (message) {
        void this.client.removeChannel(message);
      }
      if (ephemeral) {
        void this.client.removeChannel(ephemeral);
      }
    }
  }

  private async ensureSubscription(embedToken: string, sessionToken: string) {
    if (!this.running) {
      return;
    }

    const tokenStale = Date.now() > this.tokenExpiresAt - 60_000;
    // Require actual SUBSCRIBED state — non-null zombie refs after offline must not
    // short-circuit recovery.
    const channelsReady =
      this.messageChannel !== null &&
      this.ephemeralChannel !== null &&
      this.messageSubscribed &&
      this.ephemeralSubscribed &&
      !tokenStale;

    if (channelsReady) {
      this.emitCombinedConnectionState();
      return;
    }

    // Token still valid: recreate only the missing channel(s) without reminting.
    if (!tokenStale && this.client && this.messageTopic && this.ephemeralTopic) {
      this.callbacks.onConnectionState(
        this.messageSubscribed || this.ephemeralSubscribed ? "reconnecting" : "connecting",
      );
      this.subscribeMissingChannels(embedToken, sessionToken);
      return;
    }

    if (!tokenStale) {
      return;
    }

    const generation = ++this.subscribeGeneration;
    this.clearRetryTimer();
    await this.teardown();

    if (!this.isSubscriptionCurrent(generation)) {
      return;
    }

    this.callbacks.onConnectionState("connecting");

    let credentials: RealtimeCredentials;
    try {
      credentials = await this.api.createRealtimeToken({
        embedToken,
        sessionToken,
      });
    } catch (error) {
      if (!this.isSubscriptionCurrent(generation)) {
        return;
      }

      if (isRetriableWidgetRealtimeError(error)) {
        this.callbacks.onConnectionState("reconnecting");
        this.scheduleSubscriptionRetry(embedToken, sessionToken);
        return;
      }

      this.callbacks.onConnectionState("failed");
      return;
    }

    if (!this.isSubscriptionCurrent(generation)) {
      return;
    }

    this.retryAttempt = 0;
    this.messageTopic = credentials.messageTopic;
    this.ephemeralTopic = credentials.ephemeralTopic;
    // Session subject + per-tab suffix: multi-tab stays online until the last tab leaves.
    this.presenceKey = `${credentials.presenceKey}:${this.tabPresenceSuffix}`;
    this.tokenExpiresAt = new Date(credentials.expiresAt).getTime();

    const supabase = resolveWidgetSupabaseConfig({
      supabaseUrl: credentials.supabaseUrl,
      supabaseAnonKey: credentials.supabaseAnonKey,
    });

    if (!supabase) {
      this.callbacks.onConnectionState("failed");
      return;
    }

    this.client = createClient(supabase.url, supabase.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    await this.client.realtime.setAuth(credentials.token);

    if (!this.isSubscriptionCurrent(generation)) {
      await this.teardown();
      return;
    }

    this.subscribeMissingChannels(embedToken, sessionToken);
  }

  private subscribeMissingChannels(embedToken: string, sessionToken: string) {
    if (!this.messageChannel) {
      this.subscribeMessageChannel(embedToken, sessionToken);
    }
    if (!this.ephemeralChannel) {
      this.subscribeEphemeralChannel(embedToken, sessionToken);
    }
  }

  private subscribeMessageChannel(embedToken: string, sessionToken: string) {
    if (!this.client || !this.messageTopic || this.messageChannel) {
      return;
    }

    this.messageSubscribed = false;

    const channel = this.client
      .channel(this.messageTopic, {
        config: {
          private: true,
        },
      })
      .on("broadcast", { event: "message.created" }, (payload) => {
        if (this.messageChannel !== channel) {
          return;
        }
        const parsed = widgetBroadcastEventSchema.safeParse(payload.payload);
        if (!parsed.success) {
          return;
        }

        const next = toMessageViewFromWidgetBroadcast(parsed.data.message);
        this.messages = mergeMessages(this.messages, [next], []);
        this.callbacks.onMessages(this.messages);

        // Delivered advances when the agent message arrives (even if tab hidden).
        if (next.senderType === "agent") {
          this.markDeliveredThrough(next.sequenceNumber);
        }
      });

    this.messageChannel = channel;
    channel.subscribe((status) => {
      this.handleMessageChannelStatus(status, embedToken, sessionToken, channel);
    });
  }

  private subscribeEphemeralChannel(embedToken: string, sessionToken: string) {
    if (!this.client || !this.ephemeralTopic || this.ephemeralChannel) {
      return;
    }

    this.presenceTracked = false;
    this.ephemeralSubscribed = false;

    const channel = this.client
      .channel(this.ephemeralTopic, {
        config: {
          private: true,
          presence: {
            key: this.presenceKey,
          },
        },
      })
      .on("broadcast", { event: TYPING_BROADCAST_EVENT }, (payload) => {
        if (this.ephemeralChannel !== channel) {
          return;
        }
        this.handleTypingBroadcast(payload.payload);
      })
      .on("broadcast", { event: RECEIPT_BROADCAST_EVENT }, (payload) => {
        if (this.ephemeralChannel !== channel) {
          return;
        }
        this.handleReceiptBroadcast(payload.payload);
      })
      .on("presence", { event: "sync" }, () => {
        if (this.ephemeralChannel !== channel) {
          return;
        }
        this.emitPresenceFromChannel();
      })
      .on("presence", { event: "join" }, () => {
        if (this.ephemeralChannel !== channel) {
          return;
        }
        this.emitPresenceFromChannel();
      })
      .on("presence", { event: "leave" }, () => {
        if (this.ephemeralChannel !== channel) {
          return;
        }
        this.emitPresenceFromChannel();
      });

    this.ephemeralChannel = channel;
    channel.subscribe((status) => {
      this.handleEphemeralChannelStatus(status, embedToken, sessionToken, channel);
    });
  }

  private handleTypingBroadcast(raw: unknown) {
    const parsed = parseTypingBroadcastPayload(raw);
    if (!parsed || parsed.actorRole !== "operator") {
      return;
    }

    this.remoteTyping = applyRemoteTypingEvent({
      actors: this.remoteTyping,
      payload: parsed,
      nowMs: Date.now(),
      localActorKey: this.presenceKey,
    });
    this.emitAgentTyping();
    this.ensureTypingExpiryLoop();
  }

  private handleReceiptBroadcast(raw: unknown) {
    const parsed = parseReceiptBroadcastPayload(raw);
    if (!parsed) {
      return;
    }

    const applied = applyRemoteReceiptEvent({
      cursors: this.agentReceipts,
      payload: parsed,
      localActorKey: this.presenceKey,
      expectedRole: "operator",
    });

    if (!applied.advanced) {
      return;
    }

    this.setAgentReceipts(applied.cursors);
  }

  private setAgentReceipts(cursors: ReceiptCursors) {
    const merged = mergeReceiptCursors(this.agentReceipts, cursors);
    if (!merged.advanced) {
      return;
    }

    this.agentReceipts = merged.next;
    this.callbacks.onAgentReceipts?.(this.agentReceipts);
  }

  private markDeliveredThrough(sequence: number) {
    void this.persistReceipt("delivered", sequence);
  }

  private async persistReceipt(kind: ReceiptKind, throughSequence: number) {
    if (!this.running || throughSequence <= 0 || !this.embedToken || !this.sessionToken) {
      return;
    }

    if (kind === "delivered") {
      if (
        throughSequence <= this.localReceipts.lastDeliveredSequence ||
        throughSequence <= this.deliveredInFlightThrough
      ) {
        return;
      }
      this.deliveredInFlightThrough = throughSequence;
    } else {
      if (
        throughSequence <= this.localReceipts.lastReadSequence ||
        throughSequence <= this.readInFlightThrough
      ) {
        return;
      }
      this.readInFlightThrough = throughSequence;
    }

    try {
      const result = await this.api.markReceipt({
        embedToken: this.embedToken,
        sessionToken: this.sessionToken,
        kind,
        throughSequence,
      });

      const merged = mergeReceiptCursors(this.localReceipts, {
        lastDeliveredSequence: result.last_delivered_sequence,
        lastReadSequence: result.last_read_sequence,
      });
      this.localReceipts = merged.next;

      if (!result.updated) {
        return;
      }

      await this.broadcastReceipt({
        kind,
        lastDeliveredSequence: this.localReceipts.lastDeliveredSequence,
        lastReadSequence: this.localReceipts.lastReadSequence,
      });
    } catch {
      // Durable write failed — next catch-up / visible pass can retry.
    } finally {
      if (kind === "delivered" && this.deliveredInFlightThrough === throughSequence) {
        this.deliveredInFlightThrough = 0;
      }
      if (kind === "read" && this.readInFlightThrough === throughSequence) {
        this.readInFlightThrough = 0;
      }
    }
  }

  private async broadcastReceipt(input: {
    kind: ReceiptKind;
    lastDeliveredSequence: number;
    lastReadSequence: number;
  }) {
    if (!this.ephemeralChannel || !this.presenceKey) {
      return;
    }

    const payload = buildReceiptBroadcastPayload({
      actorRole: "visitor",
      actorKey: this.presenceKey,
      kind: input.kind,
      lastDeliveredSequence: input.lastDeliveredSequence,
      lastReadSequence: input.lastReadSequence,
    });

    try {
      await this.ephemeralChannel.send({
        type: "broadcast",
        event: RECEIPT_BROADCAST_EVENT,
        payload,
      });
    } catch {
      // Ephemeral — durable cursor already persisted via API.
    }
  }

  private emitAgentTyping() {
    const active = isAnyoneTyping(this.remoteTyping, "operator");
    this.callbacks.onAgentTyping?.({
      active,
      displayName: active ? resolveTypingDisplayName(this.remoteTyping, "operator") : null,
    });
  }

  private clearRemoteTyping() {
    if (this.remoteTyping.size === 0) {
      this.callbacks.onAgentTyping?.({ active: false, displayName: null });
      return;
    }

    this.remoteTyping = new Map();
    this.callbacks.onAgentTyping?.({ active: false, displayName: null });
  }

  private ensureTypingExpiryLoop() {
    if (this.typingExpiryTimer !== null) {
      return;
    }

    this.typingExpiryTimer = setInterval(() => {
      const { actors, changed } = expireRemoteTypingActors({
        actors: this.remoteTyping,
        nowMs: Date.now(),
      });
      if (!changed) {
        if (actors.size === 0) {
          this.stopTypingExpiryLoop();
        }
        return;
      }

      this.remoteTyping = actors;
      this.emitAgentTyping();
      if (actors.size === 0) {
        this.stopTypingExpiryLoop();
      }
    }, 500);
  }

  private stopTypingExpiryLoop() {
    if (this.typingExpiryTimer !== null) {
      clearInterval(this.typingExpiryTimer);
      this.typingExpiryTimer = null;
    }
  }

  private armTypingIdleTimer() {
    this.clearTypingIdleTimer();
    this.typingIdleTimer = setTimeout(() => {
      this.typingIdleTimer = null;
      void this.emitTypingStopped();
    }, TYPING_IDLE_STOP_MS);
  }

  private clearTypingIdleTimer() {
    if (this.typingIdleTimer !== null) {
      clearTimeout(this.typingIdleTimer);
      this.typingIdleTimer = null;
    }
  }

  private async emitTypingStopped() {
    if (!this.localTyping) {
      this.lastTypingStartedAt = null;
      return;
    }

    this.localTyping = false;
    this.lastTypingStartedAt = null;
    await this.broadcastTyping("stopped");
  }

  private async broadcastTyping(state: "started" | "stopped") {
    if (!this.ephemeralChannel || !this.presenceKey) {
      return;
    }

    const payload = buildTypingBroadcastPayload({
      actorRole: "visitor",
      actorKey: this.presenceKey,
      state,
    });

    try {
      await this.ephemeralChannel.send({
        type: "broadcast",
        event: TYPING_BROADCAST_EVENT,
        payload,
      });
    } catch {
      // Ephemeral — ignore send failures; remote TTL will clear stale state.
    }
  }

  private emitPresenceFromChannel() {
    if (!this.ephemeralChannel) {
      this.callbacks.onPresence?.({ operatorsOnline: false });
      return;
    }

    const state = this.ephemeralChannel.presenceState();
    const peers: PresencePeer[] = reconcilePresencePeers(state);
    this.callbacks.onPresence?.({
      operatorsOnline: isRoleOnline(peers, "operator"),
    });
  }

  private async trackVisitorPresence() {
    if (!this.ephemeralChannel || !this.presenceKey || this.presenceTracked) {
      return;
    }

    try {
      await this.ephemeralChannel.track(
        buildPresenceStatePayload({
          role: "visitor",
        }),
      );
      this.presenceTracked = true;
    } catch {
      this.presenceTracked = false;
    }
  }

  private emitCombinedConnectionState() {
    // Aggregate: both channels must be live. One failure must not leave us stuck
    // "connected" while presence/typing is dead, nor stuck "failed" when the other
    // channel can still recover.
    if (this.messageSubscribed && this.ephemeralSubscribed) {
      this.callbacks.onConnectionState("connected");
      return;
    }

    if (this.messageChannel || this.ephemeralChannel) {
      const recovering = this.messageSubscribed || this.ephemeralSubscribed;
      this.callbacks.onConnectionState(recovering ? "reconnecting" : "connecting");
    }
  }

  private handleMessageChannelStatus(
    status: string,
    embedToken: string,
    sessionToken: string,
    channel: RealtimeChannel,
  ) {
    // Ignore callbacks from channels already replaced by offline/online recreate.
    if (this.messageChannel !== channel) {
      return;
    }

    if (status === "SUBSCRIBED") {
      this.messageSubscribed = true;
      this.retryAttempt = 0;
      this.emitCombinedConnectionState();
      void this.catchUp({ embedToken, sessionToken });
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.messageChannel = null;
      this.messageSubscribed = false;
      void this.client?.removeChannel(channel);

      this.callbacks.onConnectionState("reconnecting");
      this.scheduleSubscriptionRetry(embedToken, sessionToken);
      return;
    }

    if (status === "CLOSED") {
      this.messageChannel = null;
      this.messageSubscribed = false;
      if (this.running) {
        this.callbacks.onConnectionState("reconnecting");
        this.scheduleSubscriptionRetry(embedToken, sessionToken);
      }
    }
  }

  private handleEphemeralChannelStatus(
    status: string,
    embedToken: string,
    sessionToken: string,
    channel: RealtimeChannel,
  ) {
    if (this.ephemeralChannel !== channel) {
      return;
    }

    if (status === "SUBSCRIBED") {
      this.ephemeralSubscribed = true;
      this.retryAttempt = 0;
      void this.trackVisitorPresence();
      this.emitCombinedConnectionState();
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.ephemeralChannel = null;
      this.ephemeralSubscribed = false;
      this.presenceTracked = false;
      void this.client?.removeChannel(channel);

      this.clearRemoteTyping();
      this.callbacks.onPresence?.({ operatorsOnline: false });
      // Recreate the missing ephemeral channel without blocking message channel recovery.
      this.callbacks.onConnectionState("reconnecting");
      this.scheduleSubscriptionRetry(embedToken, sessionToken);
      return;
    }

    if (status === "CLOSED") {
      this.ephemeralChannel = null;
      this.ephemeralSubscribed = false;
      this.presenceTracked = false;
      this.clearRemoteTyping();
      this.callbacks.onPresence?.({ operatorsOnline: false });
      if (this.running) {
        this.callbacks.onConnectionState("reconnecting");
        this.scheduleSubscriptionRetry(embedToken, sessionToken);
      }
    }
  }

  private async teardownChannel(channel: RealtimeChannel | null, untrack: boolean) {
    if (!channel || !this.client) {
      return;
    }

    if (untrack) {
      try {
        await channel.untrack();
      } catch {
        // ignore
      }
    }

    await this.client.removeChannel(channel);
  }

  private async teardown() {
    this.clearTypingIdleTimer();
    void this.emitTypingStopped();
    this.presenceTracked = false;
    this.messageSubscribed = false;
    this.ephemeralSubscribed = false;

    const message = this.messageChannel;
    const ephemeral = this.ephemeralChannel;
    this.messageChannel = null;
    this.ephemeralChannel = null;

    await this.teardownChannel(ephemeral, true);
    await this.teardownChannel(message, false);
    this.client = null;
  }
}

export function mapWidgetHttpMessages(
  items: Array<{
    id: string;
    sequence_number: number;
    sender_type: "visitor" | "agent" | "system";
    body: string;
    created_at: string;
    client_message_id?: string | null;
  }>,
): MessageView[] {
  return items.map((item) => toMessageViewFromWidgetHttp(item));
}

/** Test helper: remote typing TTL constant. */
export { TYPING_REMOTE_TTL_MS };
