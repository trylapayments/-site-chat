import { z } from "zod";

import { listQuerySchema } from "./list-query";

export const conversationStatusSchema = z.enum(["open", "pending", "resolved", "closed"]);

export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const channelTypeSchema = z.enum(["widget"]);

export const assigneeSchema = z
  .object({
    member_id: z.string().uuid(),
    display_label: z.string(),
  })
  .strict()
  .nullable();

export const contactSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  })
  .strict()
  .nullable();

export const contactDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  })
  .strict()
  .nullable();

export const conversationListItemSchema = z
  .object({
    id: z.string().uuid(),
    status: conversationStatusSchema,
    channel_type: channelTypeSchema,
    assigned_to: assigneeSchema,
    contact: contactSummarySchema,
    last_message_at: z.string().nullable(),
    last_message_preview: z.string().nullable(),
    message_count: z.number().int(),
    has_unread: z.boolean(),
    created_at: z.string(),
  })
  .strict();

export type ConversationListItem = z.infer<typeof conversationListItemSchema>;

export const listConversationsQuerySchema = listQuerySchema
  .extend({
    status: conversationStatusSchema.optional(),
    assignment: z.enum(["all", "unassigned", "assigned_to_me"]).optional(),
  })
  .strict();

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const listConversationsResultSchema = z
  .object({
    items: z.array(conversationListItemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .strict();

export type ListConversationsResult = z.infer<typeof listConversationsResultSchema>;

export const conversationDetailSchema = z
  .object({
    id: z.string().uuid(),
    status: conversationStatusSchema,
    channel_type: channelTypeSchema,
    assigned_to: assigneeSchema,
    contact: contactDetailSchema,
    visitor_session_id: z.string().uuid(),
    source_url: z.string().nullable(),
    message_count: z.number().int(),
    last_message_at: z.string().nullable(),
    has_unread: z.boolean(),
    created_at: z.string(),
    resolved_at: z.string().nullable(),
  })
  .strict();

export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const messageItemSchema = z
  .object({
    id: z.string().uuid(),
    sequence_number: z.number().int(),
    sender_type: z.enum(["visitor", "agent", "system"]),
    sender_label: z.string(),
    body: z.string(),
    is_internal: z.boolean(),
    created_at: z.string(),
  })
  .strict();

export type MessageItem = z.infer<typeof messageItemSchema>;

export const listMessagesQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    before_sequence: z.number().int().positive().optional(),
  })
  .strict();

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const listMessagesResultSchema = z
  .object({
    items: z.array(messageItemSchema),
    has_older: z.boolean(),
    oldest_sequence: z.number().int().nullable(),
  })
  .strict();

export type ListMessagesResult = z.infer<typeof listMessagesResultSchema>;

export const sendOperatorMessageResultSchema = z
  .object({
    message: z
      .object({
        id: z.string().uuid(),
        sequence_number: z.number().int(),
        body: z.string(),
        created_at: z.string(),
      })
      .strict(),
    conversation: z
      .object({
        id: z.string().uuid(),
        status: conversationStatusSchema,
        last_message_at: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type SendOperatorMessageResult = z.infer<typeof sendOperatorMessageResultSchema>;

export const markConversationReadResultSchema = z
  .object({
    last_read_sequence: z.number().int(),
    has_unread: z.boolean(),
  })
  .strict();

export type MarkConversationReadResult = z.infer<typeof markConversationReadResultSchema>;

export const sendMessageSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
    clientMessageId: z.string().uuid().optional(),
  })
  .strict();

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const assignConversationSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    assigneeMemberId: z.string().uuid().nullable(),
  })
  .strict();

export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

export const updateConversationStatusSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    status: conversationStatusSchema,
  })
  .strict();

export type UpdateConversationStatusInput = z.infer<typeof updateConversationStatusSchema>;

export const markConversationReadSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    throughSequence: z.number().int().nonnegative().optional(),
  })
  .strict();

export type MarkConversationReadInput = z.infer<typeof markConversationReadSchema>;

export const workspaceMemberOptionSchema = z
  .object({
    member_id: z.string().uuid(),
    display_label: z.string(),
    role: z.enum(["owner", "admin", "agent", "viewer"]),
  })
  .strict();

export type WorkspaceMemberOption = z.infer<typeof workspaceMemberOptionSchema>;
