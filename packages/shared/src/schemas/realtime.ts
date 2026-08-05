import { z } from "zod";

export const widgetBroadcastMessageSchema = z
  .object({
    id: z.string().uuid(),
    sequenceNumber: z.number().int(),
    senderType: z.enum(["visitor", "agent", "system"]),
    body: z.string(),
    createdAt: z.string(),
    clientMessageId: z.string().uuid().nullable(),
  })
  .strict();

export type WidgetBroadcastMessage = z.infer<typeof widgetBroadcastMessageSchema>;

export const widgetBroadcastEventSchema = z
  .object({
    type: z.literal("message.created"),
    message: widgetBroadcastMessageSchema,
  })
  .strict();

export type WidgetBroadcastEvent = z.infer<typeof widgetBroadcastEventSchema>;

export const widgetRealtimeTokenDataSchema = z
  .object({
    token: z.string().min(1),
    topic: z.string().regex(/^widget-conversation:[a-f0-9]{64}$/),
    expiresAt: z.string(),
  })
  .strict();

export type WidgetRealtimeTokenData = z.infer<typeof widgetRealtimeTokenDataSchema>;

export const operatorMessageChangeSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    sequence_number: z.coerce.number().int(),
    sender_type: z.enum(["visitor", "agent", "system"]),
    body: z.string(),
    is_internal: z.coerce.boolean(),
    client_message_id: z.string().uuid().nullable().optional(),
    created_at: z.string(),
  })
  .strict();

export type OperatorMessageChange = z.infer<typeof operatorMessageChangeSchema>;

export const operatorConversationChangeSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    status: z.enum(["open", "pending", "resolved", "closed"]),
    assigned_to: z.string().uuid().nullable(),
    last_message_at: z.string().nullable(),
    last_message_preview: z.string().nullable(),
    message_count: z.coerce.number().int(),
    updated_at: z.string(),
  })
  .strict();

export type OperatorConversationChange = z.infer<typeof operatorConversationChangeSchema>;

export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export type PendingMessageStatus = "pending" | "sent" | "failed";

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
