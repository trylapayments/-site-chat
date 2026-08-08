import {
  widgetListMessagesDataSchema,
  widgetMarkReceiptDataSchema,
  widgetPublicConfigSchema,
  widgetSendMessageDataSchema,
  widgetSessionDataSchema,
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

  return Boolean(data);
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

  return Boolean(data);
}

export async function createOrResumeVisitorSession(input: {
  workspaceId: string;
  sessionToken?: string | null;
  locale?: string;
  pageUrl?: string | null;
  referrer?: string | null;
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
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    "widget session",
    data as Json,
    widgetSessionDataSchema,
  );
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
    data as Json,
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
    data as Json,
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
    data as Json,
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
