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

export class WidgetRealtimeTransport {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private messages: MessageView[] = [];
  private tokenExpiresAt = 0;
  private topic = "";
  private running = false;

  constructor(
    private readonly api: WidgetApiClient,
    private readonly callbacks: WidgetTransportCallbacks,
  ) {}

  async start(input: { embedToken: string; sessionToken: string; initialMessages: MessageView[] }) {
    this.running = true;
    this.messages = input.initialMessages;
    this.callbacks.onMessages(this.messages);
    await this.ensureSubscription(input.embedToken, input.sessionToken);
    this.attachLifecycle(input.embedToken, input.sessionToken);
  }

  stop() {
    this.running = false;
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

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
  }

  private async ensureSubscription(embedToken: string, sessionToken: string) {
    if (!this.running) {
      return;
    }

    if (Date.now() > this.tokenExpiresAt - 60_000) {
      await this.teardown();
      this.callbacks.onConnectionState("connecting");

      const credentials = await this.api.createRealtimeToken({
        embedToken,
        sessionToken,
      });

      this.topic = credentials.topic;
      this.tokenExpiresAt = new Date(credentials.expiresAt).getTime();

      const url = __SITECHAT_SUPABASE_URL__;
      const key = __SITECHAT_SUPABASE_KEY__;

      if (!url || !key) {
        this.callbacks.onConnectionState("failed");
        return;
      }

      this.client = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      await this.client.realtime.setAuth(credentials.token);

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
  }

  private handleChannelStatus(status: string, embedToken: string, sessionToken: string) {
    if (status === "SUBSCRIBED") {
      this.callbacks.onConnectionState("connected");
      void this.catchUp({ embedToken, sessionToken });
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.callbacks.onConnectionState("reconnecting");
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
