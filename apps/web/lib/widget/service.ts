import {
  visitorIdentifyDataSchema,
  visitorPageViewDataSchema,
  widgetListMessagesDataSchema,
  widgetMarkReceiptDataSchema,
  widgetPublicConfigSchema,
  widgetSendMessageDataSchema,
  widgetSessionDataSchema,
  type DeviceType,
  type VisitorIdentifyData,
  type VisitorPageViewData,
  type WidgetListMessagesData,
  type WidgetMarkReceiptData,
  type WidgetPublicConfig,
  type WidgetSendMessageData,
  type WidgetSessionData,
  type Json,
} from "@site-chat/shared";

import { createServiceClient } from "@/lib/supabase/service";

function parseRpcResult<T>(
  label: string,
  data: Json | null,
  schema: { parse: (value: unknown) => T },
): T {
  if (data === null) {
    throw new Error(`Empty ${label} response`);
  }

  const mapped =
    label === "widget public config"
      ? mapPublicConfigFromRpc(data)
      : label === "widget session"
        ? mapSessionFromRpc(data)
        : label === "widget identify"
          ? mapIdentifyFromRpc(data)
          : label === "widget page view"
            ? mapPageViewFromRpc(data)
            : label === "widget send message"
              ? mapSendMessageFromRpc(data)
              : label === "widget list messages"
                ? mapListMessagesFromRpc(data)
                : data;

  return schema.parse(mapped);
}

function asRecord(value: Json): Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid RPC payload");
  }
  return value as Record<string, Json>;
}

function mapPublicConfigFromRpc(data: Json): unknown {
  const record = asRecord(data);
  const config = asRecord(record.config ?? {});
  const branding = asRecord(config.branding ?? {});

  return {
    workspaceId: record.workspace_id,
    widgetPublicKey: record.widget_public_key,
    config: {
      locale: config.locale ?? "en",
      greetingMessage: config.greetingMessage,
      reopenWindowHours: config.reopenWindowHours,
      branding: {
        displayName: branding.displayName ?? null,
        logoUrl: branding.logoUrl ?? null,
        primaryColor: branding.primaryColor,
        showPoweredBy: branding.showPoweredBy ?? true,
      },
      position: config.position ?? "bottom-right",
    },
  };
}

function mapSessionFromRpc(data: Json): unknown {
  const record = asRecord(data);

  return {
    sessionToken: record.session_token,
    expiresAt: record.expires_at,
    locale: record.locale,
    hasConversation: Boolean(record.has_conversation),
    conversationStatus: record.conversation_status ?? null,
    visitorPublicId: record.visitor_public_id ?? null,
  };
}

function mapIdentifyFromRpc(data: Json): unknown {
  const record = asRecord(data);

  return {
    visitorPublicId: record.public_id,
    name: record.name ?? null,
    email: record.email ?? null,
    phone: record.phone ?? null,
    attributes:
      typeof record.attributes === "object" &&
      record.attributes !== null &&
      !Array.isArray(record.attributes)
        ? record.attributes
        : {},
  };
}

function mapPageViewFromRpc(data: Json): unknown {
  const record = asRecord(data);

  return {
    recorded: Boolean(record.recorded),
    deduped: Boolean(record.deduped),
    currentUrl: record.current_url ?? null,
    currentTitle: record.current_title ?? null,
  };
}

function mapSendMessageFromRpc(data: Json): unknown {
  const record = asRecord(data);
  const message = asRecord(record.message ?? {});

  return {
    message: {
      id: message.id,
      sequence_number: message.sequence_number,
      sender_type: message.sender_type,
      body: message.body,
      created_at: message.created_at,
      client_message_id: message.client_message_id ?? null,
      attachments: message.attachments ?? [],
    },
    conversationStatus: record.conversation_status,
  };
}

function mapListMessagesFromRpc(data: Json): unknown {
  const record = asRecord(data);

  return {
    items: record.items ?? [],
    has_older: record.has_older ?? false,
    oldest_sequence: record.oldest_sequence ?? null,
    agent_last_read_sequence: record.agent_last_read_sequence ?? 0,
    agent_last_delivered_sequence: record.agent_last_delivered_sequence ?? 0,
    visitor_last_read_sequence: record.visitor_last_read_sequence ?? 0,
    visitor_last_delivered_sequence:
      record.visitor_last_delivered_sequence ?? 0,
  };
}

export type WidgetWorkspaceLookup = {
  workspaceId: string;
  widgetPublicKey: string;
  config: WidgetPublicConfig;
};

export async function resolveWidgetByPublicKey(
  widgetPublicKey: string,
): Promise<WidgetWorkspaceLookup | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_resolve_public_key", {
    p_widget_public_key: widgetPublicKey,
  });

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const parsed = parseRpcResult("widget public config", data as Json, {
    parse: (value) => {
      const record = value as {
        workspaceId: string;
        widgetPublicKey: string;
        config: WidgetPublicConfig;
      };
      return {
        workspaceId: record.workspaceId,
        widgetPublicKey: record.widgetPublicKey,
        config: widgetPublicConfigSchema.parse(record.config),
      };
    },
  });

  return parsed;
}

export async function validateWidgetOrigin(
  workspaceId: string,
  origin: string,
  requireVerified: boolean,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_validate_origin", {
    p_workspace_id: workspaceId,
    p_origin: origin,
    p_require_verified: requireVerified,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function consumeWidgetRateLimit(
  bucketKey: string,
  windowSeconds: number,
  limit: number,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function createOrResumeVisitorSession(input: {
  workspaceId: string;
  sessionToken?: string | null;
  locale?: string;
  pageUrl?: string | null;
  referrer?: string | null;
  visitorPublicId?: string | null;
  pageTitle?: string | null;
  timezone?: string | null;
  language?: string | null;
  browserFamily?: string | null;
  browserVersion?: string | null;
  osFamily?: string | null;
  deviceType?: DeviceType | null;
  landingUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}): Promise<WidgetSessionData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc(
    "widget_create_or_resume_visitor_session",
    {
      p_workspace_id: input.workspaceId,
      p_session_token: input.sessionToken ?? undefined,
      p_locale: input.locale ?? "en",
      p_page_url: input.pageUrl ?? undefined,
      p_referrer: input.referrer ?? undefined,
      p_visitor_public_id: input.visitorPublicId ?? undefined,
      p_page_title: input.pageTitle ?? undefined,
      p_timezone: input.timezone ?? undefined,
      p_language: input.language ?? undefined,
      p_browser_family: input.browserFamily ?? undefined,
      p_browser_version: input.browserVersion ?? undefined,
      p_os_family: input.osFamily ?? undefined,
      p_device_type: input.deviceType ?? undefined,
      p_landing_url: input.landingUrl ?? undefined,
      p_utm_source: input.utmSource ?? undefined,
      p_utm_medium: input.utmMedium ?? undefined,
      p_utm_campaign: input.utmCampaign ?? undefined,
      p_utm_content: input.utmContent ?? undefined,
      p_utm_term: input.utmTerm ?? undefined,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult("widget session", data, widgetSessionDataSchema);
}

export async function identifyVisitor(input: {
  workspaceId: string;
  sessionToken: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneE164?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
}): Promise<VisitorIdentifyData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_identify_visitor", {
    p_workspace_id: input.workspaceId,
    p_session_token: input.sessionToken,
    p_name: input.name ?? undefined,
    p_email: input.email ?? undefined,
    p_phone: input.phone ?? undefined,
    p_phone_e164: input.phoneE164 ?? undefined,
    p_attributes: input.attributes ?? undefined,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult("widget identify", data, visitorIdentifyDataSchema);
}

export async function recordPageView(input: {
  workspaceId: string;
  sessionToken: string;
  url: string;
  title?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}): Promise<VisitorPageViewData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_record_page_view", {
    p_workspace_id: input.workspaceId,
    p_session_token: input.sessionToken,
    p_url: input.url,
    p_title: input.title ?? undefined,
    p_referrer: input.referrer ?? undefined,
    p_utm_source: input.utmSource ?? undefined,
    p_utm_medium: input.utmMedium ?? undefined,
    p_utm_campaign: input.utmCampaign ?? undefined,
    p_utm_content: input.utmContent ?? undefined,
    p_utm_term: input.utmTerm ?? undefined,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult("widget page view", data, visitorPageViewDataSchema);
}

export async function sendVisitorMessage(input: {
  workspaceId: string;
  sessionToken: string;
  body: string;
  clientMessageId?: string;
  pageUrl?: string | null;
  referrer?: string | null;
}): Promise<WidgetSendMessageData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_send_visitor_message", {
    p_workspace_id: input.workspaceId,
    p_session_token: input.sessionToken,
    p_body: input.body,
    p_client_message_id: input.clientMessageId,
    p_page_url: input.pageUrl ?? undefined,
    p_referrer: input.referrer ?? undefined,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult(
    "widget send message",
    data,
    widgetSendMessageDataSchema,
  );
}

export async function listVisitorMessages(input: {
  workspaceId: string;
  sessionToken: string;
  limit?: number;
  beforeSequence?: number;
  afterSequence?: number;
}): Promise<WidgetListMessagesData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_list_visitor_messages", {
    p_workspace_id: input.workspaceId,
    p_session_token: input.sessionToken,
    p_limit: input.limit ?? 50,
    p_before_sequence: input.beforeSequence,
    p_after_sequence: input.afterSequence,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult(
    "widget list messages",
    data,
    widgetListMessagesDataSchema,
  );
}

export async function markVisitorConversationReceipt(input: {
  workspaceId: string;
  sessionToken: string;
  kind: "delivered" | "read";
  throughSequence: number;
}): Promise<WidgetMarkReceiptData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc(
    "widget_mark_conversation_receipt",
    {
      p_workspace_id: input.workspaceId,
      p_session_token: input.sessionToken,
      p_kind: input.kind,
      p_through_sequence: input.throughSequence,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    "widget mark receipt",
    data,
    widgetMarkReceiptDataSchema,
  );
}

export async function resolveWidgetRealtimeTopic(input: {
  workspaceId: string;
  sessionToken: string;
}): Promise<{
  topicKey: string;
  messageTopic: string;
  ephemeralTopic: string;
  subject: string;
}> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("widget_resolve_realtime_topic", {
    p_workspace_id: input.workspaceId,
    p_session_token: input.sessionToken,
  });

  if (error) {
    throw error;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid realtime topic response");
  }

  const record = data as Record<string, unknown>;
  if (
    typeof record.topic_key !== "string" ||
    typeof record.message_topic !== "string" ||
    typeof record.ephemeral_topic !== "string" ||
    typeof record.subject !== "string"
  ) {
    throw new Error("Invalid realtime topic response");
  }

  return {
    topicKey: record.topic_key,
    messageTopic: record.message_topic,
    ephemeralTopic: record.ephemeral_topic,
    subject: record.subject,
  };
}
