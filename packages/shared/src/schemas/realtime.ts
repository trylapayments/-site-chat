import { z } from "zod";

import type { MessageReceiptStatus } from "../realtime/receipts.js";
import { messageAttachmentViewSchema } from "./attachments.js";

export const widgetBroadcastMessageSchema = z.object({
  id: z.string().uuid(),
  sequenceNumber: z.coerce.number().int(),
  senderType: z.enum(["visitor", "agent", "system"]),
  body: z.string(),
  createdAt: z.string(),
  clientMessageId: z.string().uuid().nullable(),
  /** Optional for backward compatibility with older broadcasts. */
  attachments: z.array(messageAttachmentViewSchema).max(10).optional().default([]),
});

export type WidgetBroadcastMessage = z.infer<typeof widgetBroadcastMessageSchema>;

export const widgetBroadcastEventSchema = z.object({
  type: z.literal("message.created"),
  message: widgetBroadcastMessageSchema,
});

export type WidgetBroadcastEvent = z.infer<typeof widgetBroadcastEventSchema>;

/** Opaque 64-hex topic key shared by message + ephemeral topic names. */
export const widgetRealtimeTopicKeySchema = z.string().regex(/^[a-f0-9]{64}$/);

export type WidgetRealtimeTopicKey = z.infer<typeof widgetRealtimeTopicKeySchema>;

/** Server-originated visitor-safe message Broadcast topic. */
export const widgetMessageTopicSchema = z.string().regex(/^widget-conversation:[a-f0-9]{64}$/);

export type WidgetMessageTopic = z.infer<typeof widgetMessageTopicSchema>;

/** Typing Broadcast + Presence topic (never durable messages). */
export const widgetEphemeralTopicSchema = z.string().regex(/^widget-ephemeral:[a-f0-9]{64}$/);

export type WidgetEphemeralTopic = z.infer<typeof widgetEphemeralTopicSchema>;

/** @deprecated Prefer widgetMessageTopicSchema — kept as an alias. */
export const widgetRealtimeTopicSchema = widgetMessageTopicSchema;

export function widgetMessageTopicFromKey(topicKey: string): WidgetMessageTopic {
  return `widget-conversation:${topicKey}`;
}

export function widgetEphemeralTopicFromKey(topicKey: string): WidgetEphemeralTopic {
  return `widget-ephemeral:${topicKey}`;
}

export const widgetRealtimeTokenDataSchema = z
  .object({
    token: z.string().min(1),
    /** Private topic for server-originated `message.created` Broadcast (SELECT only). */
    messageTopic: widgetMessageTopicSchema,
    /** Private topic for typing Broadcast + Presence (SELECT + INSERT). */
    ephemeralTopic: widgetEphemeralTopicSchema,
    /**
     * Opaque presence/typing actor key for this visitor session (JWT `sub`).
     * Stable across tabs for the same session; not a raw session UUID.
     */
    presenceKey: z.string().min(1).max(128),
    expiresAt: z.string(),
    /** Public Supabase project URL for the widget Realtime WebSocket client. */
    supabaseUrl: z.string().url(),
    /** Public anon/publishable key paired with supabaseUrl (not a secret). */
    supabaseAnonKey: z.string().min(1),
  })
  .strict();

export type WidgetRealtimeTokenData = z.infer<typeof widgetRealtimeTokenDataSchema>;

export const operatorMessageChangeSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sequence_number: z.coerce.number().int(),
  sender_type: z.enum(["visitor", "agent", "system"]),
  body: z.string(),
  is_internal: z.coerce.boolean(),
  client_message_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  metadata_json: z.record(z.unknown()).optional(),
});

export type OperatorMessageChange = z.infer<typeof operatorMessageChangeSchema>;

export const operatorConversationChangeSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  status: z.enum(["open", "pending", "resolved", "closed"]),
  assigned_to: z.string().uuid().nullable(),
  last_message_at: z.string().nullable(),
  last_message_preview: z.string().nullable(),
  message_count: z.coerce.number().int(),
  updated_at: z.string(),
});

export type OperatorConversationChange = z.infer<typeof operatorConversationChangeSchema>;

export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export type PendingMessageStatus = "pending" | "sent" | "failed";

export type MessageAttachmentViewModel = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "document";
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sortOrder: number;
  hasThumbnail: boolean;
};

export type MessageView = {
  id: string;
  sequenceNumber: number;
  senderType: "visitor" | "agent" | "system";
  senderLabel: string;
  body: string;
  createdAt: string;
  clientMessageId?: string | null;
  isInternal?: boolean;
  status?: PendingMessageStatus;
  isOptimistic?: boolean;
  /** sent → delivered → seen for local-party messages; omit for peer/system. */
  receiptStatus?: MessageReceiptStatus;
  attachments?: MessageAttachmentViewModel[];
};

export function genericSenderLabel(senderType: "visitor" | "agent" | "system"): string {
  switch (senderType) {
    case "agent":
      return "Agent";
    case "visitor":
      return "Visitor";
    default:
      return "System";
  }
}
