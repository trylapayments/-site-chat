import type { WidgetLocale } from "@site-chat/shared";

export const WIDGET_EMBED_TOKEN_HEADER = "X-SiteChat-Embed-Token";

export type WidgetBranding = {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  showPoweredBy: boolean;
};

export type WidgetPublicConfig = {
  locale: WidgetLocale;
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
  locale: WidgetLocale;
  hasConversation: boolean;
  conversationStatus: "open" | "pending" | "resolved" | "closed" | null;
  visitorPublicId?: string | null;
};

export type IdentifyPayload = {
  visitorPublicId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  attributes: Record<string, string | number | boolean | null>;
};

export type PageViewPayload = {
  recorded: boolean;
  deduped: boolean;
  currentUrl: string | null;
  currentTitle: string | null;
};

export type AttachmentPayload = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: "image" | "document";
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  sort_order?: number;
  has_thumbnail?: boolean;
};

export type MessagePayload = {
  id: string;
  sequence_number: number;
  sender_type: "visitor" | "agent" | "system";
  body: string;
  created_at: string;
  client_message_id?: string | null;
  attachments?: AttachmentPayload[];
};

export type InitiateUploadsPayload = {
  batchId: string;
  conversationId: string;
  uploads: Array<{
    localId: string;
    uploadId: string;
    attachmentId: string;
    storageKey: string;
    uploadUrl: string;
    uploadToken: string | null;
    expiresAt: string;
    headers?: Record<string, string>;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    kind: "image" | "document";
  }>;
};

export type AttachmentDownloadPayload = {
  url: string;
  expiresAt: string;
  filename: string;
  mimeType: string;
  contentDisposition: string;
};

export type WidgetReceiptCursorsPayload = {
  agent_last_read_sequence: number;
  agent_last_delivered_sequence: number;
  visitor_last_read_sequence: number;
  visitor_last_delivered_sequence: number;
};

export type ListMessagesPayload = {
  items: MessagePayload[];
  has_older: boolean;
  oldest_sequence: number | null;
} & WidgetReceiptCursorsPayload;

export type MarkReceiptPayload = {
  last_delivered_sequence: number;
  last_read_sequence: number;
  updated: boolean;
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
    locale?: WidgetLocale;
    pageUrl?: string | null;
    pageTitle?: string | null;
    referrer?: string | null;
    visitorPublicId?: string | null;
    timezone?: string | null;
    language?: string | null;
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
        pageTitle: input.pageTitle ?? null,
        referrer: input.referrer ?? null,
        visitorPublicId: input.visitorPublicId ?? null,
        timezone: input.timezone ?? null,
        language: input.language ?? null,
      }),
    });

    return this.parseResponse<SessionPayload>(response);
  }

  async identify(input: {
    embedToken: string;
    sessionToken: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    attributes?: Record<string, string | number | boolean | null>;
  }): Promise<IdentifyPayload> {
    const response = await fetch(new URL("/api/v1/widget/identify", this.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
      },
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
        name: input.name,
        email: input.email,
        phone: input.phone,
        attributes: input.attributes,
      }),
    });

    return this.parseResponse(response);
  }

  async recordPageView(input: {
    embedToken: string;
    sessionToken: string;
    url: string;
    title?: string | null;
    referrer?: string | null;
    timezone?: string | null;
    language?: string | null;
  }): Promise<PageViewPayload> {
    const response = await fetch(new URL("/api/v1/widget/page-view", this.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
      },
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
        url: input.url,
        title: input.title ?? null,
        referrer: input.referrer ?? null,
        timezone: input.timezone ?? null,
        language: input.language ?? null,
      }),
    });

    return this.parseResponse(response);
  }

  async listMessages(input: {
    embedToken: string;
    sessionToken: string;
    beforeSequence?: number;
    afterSequence?: number;
  }): Promise<ListMessagesPayload> {
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

  async markReceipt(input: {
    embedToken: string;
    sessionToken: string;
    kind: "delivered" | "read";
    throughSequence: number;
  }): Promise<MarkReceiptPayload> {
    const response = await fetch(new URL("/api/v1/widget/receipts", this.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
      },
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
        kind: input.kind,
        throughSequence: input.throughSequence,
      }),
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

  async createRealtimeToken(input: { embedToken: string; sessionToken: string }): Promise<{
    token: string;
    messageTopic: string;
    ephemeralTopic: string;
    presenceKey: string;
    expiresAt: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
  }> {
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

  async initiateUploads(input: {
    embedToken: string;
    sessionToken: string;
    files: Array<{
      localId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      width?: number | null;
      height?: number | null;
    }>;
    body?: string;
    clientMessageId?: string;
    pageUrl?: string;
    referrer?: string;
  }): Promise<InitiateUploadsPayload> {
    const response = await fetch(new URL("/api/v1/widget/attachments/uploads", this.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
        [WIDGET_EMBED_TOKEN_HEADER]: input.embedToken,
      },
      credentials: "omit",
      body: JSON.stringify({
        embedToken: input.embedToken,
        files: input.files,
        body: input.body ?? "",
        clientMessageId: input.clientMessageId,
        pageUrl: input.pageUrl ?? null,
        referrer: input.referrer ?? null,
      }),
    });

    return this.parseResponse(response);
  }

  async completeUploads(input: {
    embedToken: string;
    sessionToken: string;
    batchId: string;
    uploadIds: string[];
    body?: string;
    clientMessageId?: string;
    pageUrl?: string;
    referrer?: string;
  }): Promise<{
    message: MessagePayload;
    conversationStatus: SessionPayload["conversationStatus"];
  }> {
    const response = await fetch(
      new URL("/api/v1/widget/attachments/uploads/complete", this.apiBase),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.sessionToken}`,
          "Content-Type": "application/json",
          [WIDGET_EMBED_TOKEN_HEADER]: input.embedToken,
        },
        credentials: "omit",
        body: JSON.stringify({
          embedToken: input.embedToken,
          batchId: input.batchId,
          uploadIds: input.uploadIds,
          body: input.body ?? "",
          clientMessageId: input.clientMessageId,
          pageUrl: input.pageUrl ?? null,
          referrer: input.referrer ?? null,
        }),
      },
    );

    return this.parseResponse(response);
  }

  async cancelUploads(input: {
    embedToken: string;
    sessionToken: string;
    batchId: string;
    uploadIds?: string[];
  }): Promise<{ cancelled: number }> {
    const response = await fetch(
      new URL("/api/v1/widget/attachments/uploads/cancel", this.apiBase),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.sessionToken}`,
          "Content-Type": "application/json",
          [WIDGET_EMBED_TOKEN_HEADER]: input.embedToken,
        },
        credentials: "omit",
        body: JSON.stringify({
          embedToken: input.embedToken,
          batchId: input.batchId,
          uploadIds: input.uploadIds,
        }),
      },
    );

    return this.parseResponse(response);
  }

  async getAttachmentDownloadUrl(input: {
    embedToken: string;
    sessionToken: string;
    attachmentId: string;
    variant?: "full" | "thumbnail";
  }): Promise<AttachmentDownloadPayload> {
    const url = new URL(`/api/v1/widget/attachments/${input.attachmentId}/download`, this.apiBase);
    if (input.variant) {
      url.searchParams.set("variant", input.variant);
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

  private async parseResponse<T>(response: Response): Promise<T> {
    const json = (await response.json()) as ApiSuccess<T> | ApiError;

    if (!response.ok) {
      const error = json as ApiError;
      throw new Error(error.error.message);
    }

    return (json as ApiSuccess<T>).data;
  }
}
