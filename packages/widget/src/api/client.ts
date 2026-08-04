export const WIDGET_EMBED_TOKEN_HEADER = "X-SiteChat-Embed-Token";

export type WidgetBranding = {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  showPoweredBy: boolean;
};

export type WidgetPublicConfig = {
  locale: "en" | "ru";
  greetingMessage: string;
  reopenWindowHours: number;
  branding: WidgetBranding;
  position: "bottom-right" | "bottom-left";
};

export type BootstrapPayload = {
  widgetPublicKey: string;
  config: WidgetPublicConfig;
  embedToken: string;
  embedTokenExpiresAt: string;
};

export type SessionPayload = {
  sessionToken: string;
  expiresAt: string;
  locale: "en" | "ru";
  hasConversation: boolean;
  conversationStatus: "open" | "pending" | "resolved" | "closed" | null;
};

export type MessagePayload = {
  id: string;
  sequence_number: number;
  sender_type: "visitor" | "agent" | "system";
  body: string;
  created_at: string;
};

export type ApiSuccess<T> = {
  data: T;
  meta: { requestId: string };
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

export class WidgetApiClient {
  constructor(private readonly apiBase: string) {}

  async bootstrap(widgetPublicKey: string): Promise<BootstrapPayload> {
    const url = new URL("/api/v1/widget/bootstrap", this.apiBase);
    url.searchParams.set("key", widgetPublicKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
    });

    return this.parseResponse<BootstrapPayload>(response);
  }

  async createSession(input: {
    embedToken: string;
    sessionToken?: string | null;
    locale?: "en" | "ru";
    pageUrl?: string;
    referrer?: string;
  }): Promise<SessionPayload> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (input.sessionToken) {
      headers.Authorization = `Bearer ${input.sessionToken}`;
    }

    const response = await fetch(new URL("/api/v1/widget/session", this.apiBase), {
      method: "POST",
      headers,
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
        locale: input.locale,
        pageUrl: input.pageUrl ?? null,
        referrer: input.referrer ?? null,
      }),
    });

    return this.parseResponse<SessionPayload>(response);
  }

  async listMessages(input: {
    embedToken: string;
    sessionToken: string;
    beforeSequence?: number;
    afterSequence?: number;
  }): Promise<{ items: MessagePayload[]; has_older: boolean; oldest_sequence: number | null }> {
    const url = new URL("/api/v1/widget/messages", this.apiBase);
    if (input.beforeSequence) {
      url.searchParams.set("beforeSequence", String(input.beforeSequence));
    }
    if (input.afterSequence) {
      url.searchParams.set("afterSequence", String(input.afterSequence));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        [WIDGET_EMBED_TOKEN_HEADER]: input.embedToken,
      },
      credentials: "omit",
    });

    return this.parseResponse(response);
  }

  async sendMessage(input: {
    embedToken: string;
    sessionToken: string;
    body: string;
    clientMessageId: string;
    pageUrl?: string;
    referrer?: string;
  }): Promise<{
    message: MessagePayload;
    conversationStatus: SessionPayload["conversationStatus"];
  }> {
    const response = await fetch(new URL("/api/v1/widget/messages", this.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
      },
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
        body: input.body,
        clientMessageId: input.clientMessageId,
        pageUrl: input.pageUrl ?? null,
        referrer: input.referrer ?? null,
      }),
    });

    return this.parseResponse(response);
  }

  async createRealtimeToken(input: {
    embedToken: string;
    sessionToken: string;
  }): Promise<{ token: string; topic: string; expiresAt: string }> {
    const response = await fetch(new URL("/api/v1/widget/realtime-token", this.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
      },
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
      }),
    });

    return this.parseResponse(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const json = (await response.json()) as ApiSuccess<T> | ApiError;

    if (!response.ok) {
      const error = json as ApiError;
      throw new Error(error.error.message);
    }

    return (json as ApiSuccess<T>).data;
  }
}
