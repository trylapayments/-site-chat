import { z } from "zod";

export const INTERNAL_NOTE_BODY_MAX_LENGTH = 4000;
export const INTERNAL_NOTE_DEFAULT_PAGE_SIZE = 50;
export const INTERNAL_NOTE_MAX_PAGE_SIZE = 100;

export const internalNoteMentionSchema = z
  .object({
    member_id: z.string().uuid(),
    display_label: z.string().min(1).max(200),
  })
  .strict();

export type InternalNoteMention = z.infer<typeof internalNoteMentionSchema>;

export const internalNoteSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    author_member_id: z.string().uuid().nullable(),
    author_display_label: z.string().min(1).max(200),
    body: z.string().min(1).max(INTERNAL_NOTE_BODY_MAX_LENGTH),
    client_note_id: z.string().uuid().nullable().optional(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
    deleted_at: z.string().nullable().optional(),
    mentions: z.array(internalNoteMentionSchema).default([]),
  })
  .strict();

export type InternalNote = z.infer<typeof internalNoteSchema>;

export const listInternalNotesResultSchema = z
  .object({
    items: z.array(internalNoteSchema),
    tombstones: z.array(internalNoteSchema).optional().default([]),
    has_more: z.boolean(),
    next_before: z
      .object({
        created_at: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .nullable()
      .optional(),
    authoritative: z.boolean().optional().default(false),
    /**
     * Postgres-side catch-up cursor: GREATEST(catch_up_since, max returned
     * updated_at). Clients must advance only from this / returned row times —
     * never client Date.now().
     */
    server_watermark: z.string().min(1).nullable().optional(),
  })
  .strict();

export type ListInternalNotesResult = z.infer<typeof listInternalNotesResultSchema>;

export const listInternalNotesQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(INTERNAL_NOTE_MAX_PAGE_SIZE)
      .optional()
      .default(INTERNAL_NOTE_DEFAULT_PAGE_SIZE),
    before: z
      .object({
        created_at: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .optional(),
    after: z
      .object({
        created_at: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .optional(),
    include_deleted: z.boolean().optional().default(false),
    /** Soft-delete tombstones + notes updated at/after this watermark. */
    catch_up_since: z.string().min(1).optional(),
    /** Reconnect: replace active set + apply tombstones (missed deletes). */
    authoritative: z.boolean().optional().default(false),
  })
  .strict();

export type ListInternalNotesQuery = z.input<typeof listInternalNotesQuerySchema>;
export type ListInternalNotesQueryParsed = z.output<typeof listInternalNotesQuerySchema>;

export const createInternalNoteSchema = z
  .object({
    conversationId: z.string().uuid(),
    body: z.string().trim().min(1).max(INTERNAL_NOTE_BODY_MAX_LENGTH),
    clientNoteId: z.string().uuid().optional(),
    mentionedMemberIds: z.array(z.string().uuid()).max(50).optional().default([]),
  })
  .strict();

export type CreateInternalNoteInput = z.input<typeof createInternalNoteSchema>;
export type CreateInternalNoteParsed = z.output<typeof createInternalNoteSchema>;

export const updateInternalNoteSchema = z
  .object({
    noteId: z.string().uuid(),
    body: z.string().trim().min(1).max(INTERNAL_NOTE_BODY_MAX_LENGTH),
    mentionedMemberIds: z.array(z.string().uuid()).max(50).optional().default([]),
  })
  .strict();

export type UpdateInternalNoteInput = z.input<typeof updateInternalNoteSchema>;
export type UpdateInternalNoteParsed = z.output<typeof updateInternalNoteSchema>;

export const softDeleteInternalNoteSchema = z
  .object({
    noteId: z.string().uuid(),
  })
  .strict();

export type SoftDeleteInternalNoteInput = z.infer<typeof softDeleteInternalNoteSchema>;

// Notification schemas live in ./notifications.ts (PR #35).
// Re-export for backward compatibility with notes-era imports.
export {
  notificationTypeSchema,
  notificationItemSchema,
  type NotificationItem,
} from "./notifications.js";
