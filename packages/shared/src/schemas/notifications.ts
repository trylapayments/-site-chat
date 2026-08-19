import { z } from "zod";

/**
 * Operator notification taxonomy (durable in-app + email outbox categories).
 * Payloads must never include note bodies, tokens, or secrets.
 */
export const notificationTypeSchema = z.enum([
  "conversation_new",
  "visitor_message",
  "conversation_assigned",
  "conversation_transferred",
  "conversation_unassigned",
  "mention",
  "billing_payment_failed",
  "trial_ending",
]);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationPayloadSchema = z
  .object({
    v: z.number().int().positive().optional(),
    conversation_id: z.string().uuid().optional(),
    message_id: z.string().uuid().optional(),
    note_id: z.string().uuid().optional(),
    mention_id: z.string().uuid().optional(),
    actor_member_id: z.string().uuid().optional(),
    actor_label: z.string().max(200).optional(),
    assignment_version: z.number().int().optional(),
    was_transfer: z.boolean().optional(),
  })
  .strict();

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export const notificationItemSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    recipient_id: z.string().uuid(),
    type: notificationTypeSchema,
    title: z.string().min(1).max(200),
    body: z.string().max(1000).nullable().optional(),
    resource_type: z.string().max(64).nullable().optional(),
    resource_id: z.string().uuid().nullable().optional(),
    conversation_id: z.string().uuid().nullable().optional(),
    actor_member_id: z.string().uuid().nullable().optional(),
    payload: notificationPayloadSchema.optional().default({}),
    dedupe_key: z.string().min(1).max(200).optional(),
    read_at: z.string().nullable().optional(),
    created_at: z.string().min(1),
  })
  .strict();

export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListCursorSchema = z
  .object({
    before_created_at: z.string().min(1),
    before_id: z.string().uuid(),
  })
  .strict();

export const listNotificationsQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    before_created_at: z.string().min(1).optional(),
    before_id: z.string().uuid().optional(),
    unread_only: z.boolean().optional(),
  })
  .strict();

export const notificationListResultSchema = z
  .object({
    items: z.array(notificationItemSchema),
    has_more: z.boolean(),
    next_cursor: notificationListCursorSchema.nullable().optional(),
    unread_count: z.number().int().min(0),
  })
  .strict();

export type NotificationListResult = z.infer<typeof notificationListResultSchema>;

export const notificationPreferencesSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    workspace_member_id: z.string().uuid(),
    in_app_conversation_new: z.boolean(),
    in_app_visitor_message: z.boolean(),
    in_app_assignment: z.boolean(),
    in_app_mention: z.boolean(),
    in_app_transfer: z.boolean(),
    browser_enabled: z.boolean(),
    browser_conversation_new: z.boolean(),
    browser_visitor_message: z.boolean(),
    browser_assignment: z.boolean(),
    browser_mention: z.boolean(),
    browser_permission_denied_at: z.string().nullable().optional(),
    sound_enabled: z.boolean(),
    sound_visitor_message: z.boolean(),
    sound_assignment: z.boolean(),
    email_conversation_new: z.boolean(),
    email_assignment: z.boolean(),
    email_mention: z.boolean(),
    email_visitor_message: z.boolean(),
    dnd_enabled: z.boolean(),
    quiet_hours_start: z.string().nullable().optional(),
    quiet_hours_end: z.string().nullable().optional(),
    timezone: z.string().min(1).max(64),
    updated_at: z.string().optional(),
  })
  .strict();

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesSchema = z
  .object({
    in_app_conversation_new: z.boolean().optional(),
    in_app_visitor_message: z.boolean().optional(),
    in_app_assignment: z.boolean().optional(),
    in_app_mention: z.boolean().optional(),
    in_app_transfer: z.boolean().optional(),
    browser_enabled: z.boolean().optional(),
    browser_conversation_new: z.boolean().optional(),
    browser_visitor_message: z.boolean().optional(),
    browser_assignment: z.boolean().optional(),
    browser_mention: z.boolean().optional(),
    browser_permission_denied_at: z.string().nullable().optional(),
    sound_enabled: z.boolean().optional(),
    sound_visitor_message: z.boolean().optional(),
    sound_assignment: z.boolean().optional(),
    email_conversation_new: z.boolean().optional(),
    email_assignment: z.boolean().optional(),
    email_mention: z.boolean().optional(),
    email_visitor_message: z.boolean().optional(),
    dnd_enabled: z.boolean().optional(),
    quiet_hours_start: z.string().nullable().optional(),
    quiet_hours_end: z.string().nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

/** Types that Viewers may receive (no note/assignment private types). */
export const VIEWER_ALLOWED_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "conversation_new",
  "visitor_message",
  "billing_payment_failed",
  "trial_ending",
]);

export function viewerMayReceiveNotificationType(type: NotificationType): boolean {
  return VIEWER_ALLOWED_NOTIFICATION_TYPES.has(type);
}
