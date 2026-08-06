import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import {
  mergeMessages,
  toMessageViewFromWidgetBroadcast,
  toMessageViewFromWidgetHttp,
  widgetBroadcastEventSchema,
  type ConnectionState,
  type MessageView,
} from "@site-chat/shared";

import type { WidgetApiClient } from "../api/client";

declare const __SITECHAT_SUPABASE_URL__: string;
declare const __SITECHAT_SUPABASE_KEY__: string;

export type WidgetTransportCallbacks = {
  onMessages: (messages: MessageView[]) => void;
  onConnectionState: (state: ConnectionState) => void;
};

type RealtimeCredentials = {
  token: string;
  topic: string;
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

export class WidgetRealtimeTransport {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private messages: MessageView[] = [];
  private tokenExpiresAt = 0;
  private topic = "";
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private lifecycle: LifecycleHandlers | null = null;
  private subscribeGeneration = 0;

  constructor(
    private readonly api: WidgetApiClient,
    private readonly callbacks: WidgetTransportCallbacks,
  ) {}

  async start(input: { embedToken: string; sessionToken: string; initialMessages: MessageView[] }) {
    this.running = true;
    this.messages = input.initialMessages;
    this.callbacks.onMessages(this.messages);

    if (input.initialMessages.length > 0) {
      await this.ensureSubscription(input.embedToken, input.sessionToken);
    } else {
      this.callbacks.onConnectionState("connecting");
    }

    this.attachLifecycle(input.embedToken, input.sessionToken);
  }

  stop() {
    this.running = false;
    this.subscribeGeneration += 1;
    this.clearRetryTimer();
    this.detachLifecycle();
    void this.teardown();
  }

  getMessages() {
    return this.messages;
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

  async catchUp(input: { embedToken: string; sessionToken: string }) {
    let afterSequence = this.messages.reduce(
      (max, message) => Math.max(max, message.sequenceNumber),
      0,
    );

    for (let page = 0; page < 20; page += 1) {
      const listed = await this.api.listMessages({
        embedToken: input.embedToken,
        sessionToken: input.sessionToken,
        afterSequence,
      });

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
      if (this.running) {
        void this.catchUp({ embedToken, sessionToken });
        void this.ensureSubscription(embedToken, sessionToken);
      }
    };

    const onOffline = () => {
      if (this.running) {
        this.callbacks.onConnectionState("disconnected");
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

  private async ensureSubscription(embedToken: string, sessionToken: string) {
    if (!this.running) {
      return;
    }

    const tokenStale = Date.now() > this.tokenExpiresAt - 60_000;

    if (this.channel && !tokenStale) {
      return;
    }

    if (!tokenStale && this.client && this.topic) {
      this.callbacks.onConnectionState("connecting");
      this.subscribeChannel(embedToken, sessionToken);
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
    this.topic = credentials.topic;
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

    this.subscribeChannel(embedToken, sessionToken);
  }

  private subscribeChannel(embedToken: string, sessionToken: string) {
    if (!this.client || !this.topic) {
      return;
    }

    this.channel = this.client
      .channel(this.topic, { config: { private: true } })
      .on("broadcast", { event: "message.created" }, (payload) => {
        const parsed = widgetBroadcastEventSchema.safeParse(payload.payload);
        if (!parsed.success) {
          return;
        }

        const next = toMessageViewFromWidgetBroadcast(parsed.data.message);
        this.messages = mergeMessages(this.messages, [next], []);
        this.callbacks.onMessages(this.messages);
      })
      .subscribe((status) => {
        this.handleChannelStatus(status, embedToken, sessionToken);
      });
  }

  private handleChannelStatus(status: string, embedToken: string, sessionToken: string) {
    if (status === "SUBSCRIBED") {
      this.retryAttempt = 0;
      this.callbacks.onConnectionState("connected");
      void this.catchUp({ embedToken, sessionToken });
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      // Drop the failed channel so ensureSubscription does not early-return
      // on a dead RealtimeChannel and skip the scheduled retry.
      const failed = this.channel;
      this.channel = null;
      if (failed && this.client) {
        void this.client.removeChannel(failed);
      }

      this.callbacks.onConnectionState("reconnecting");
      this.scheduleSubscriptionRetry(embedToken, sessionToken);
      return;
    }

    if (status === "CLOSED") {
      this.callbacks.onConnectionState("disconnected");
    }
  }

  private async teardown() {
    if (this.channel && this.client) {
      await this.client.removeChannel(this.channel);
    }
    this.channel = null;
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
