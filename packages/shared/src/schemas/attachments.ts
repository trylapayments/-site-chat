import { z } from "zod";

import { ATTACHMENT_LIMITS } from "../attachments/limits.js";
import { sanitizePageUrl, sanitizeReferrer } from "../visitor/page-context";

export const attachmentKindSchema = z.enum(["image", "document"]);

export const attachmentScanStatusSchema = z.enum([
  "clean",
  "infected",
  "skipped",
  "pending",
  "error",
]);

export const messageAttachmentSchema = z
  .object({
    id: z.string().uuid(),
    message_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    storage_key: z.string().min(1).max(1024),
    mime_type: z.string().min(1).max(255),
    filename: z.string().min(1).max(ATTACHMENT_LIMITS.maxFilenameLength),
    size_bytes: z.number().int().positive(),
    kind: attachmentKindSchema,
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    duration_ms: z.number().int().nonnegative().nullable().optional(),
    thumbnail_storage_key: z.string().min(1).max(1024).nullable().optional(),
    scan_status: attachmentScanStatusSchema.optional(),
    sort_order: z.number().int().nonnegative().default(0),
    metadata_json: z.record(z.unknown()).default({}),
    created_at: z.string(),
  })
  .strict();

export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

/** Compact attachment view embedded on messages (API + realtime). */
export const messageAttachmentViewSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string().min(1).max(ATTACHMENT_LIMITS.maxFilenameLength),
    mime_type: z.string().min(1).max(255),
    size_bytes: z.number().int().positive(),
    kind: attachmentKindSchema,
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    duration_ms: z.number().int().nonnegative().nullable().optional(),
    sort_order: z.number().int().nonnegative().default(0),
    has_thumbnail: z.boolean().default(false),
  })
  .strict();

export type MessageAttachmentView = z.infer<typeof messageAttachmentViewSchema>;

export const attachmentUploadFileSchema = z
  .object({
    localId: z.string().min(1).max(64),
    filename: z.string().min(1).max(ATTACHMENT_LIMITS.maxFilenameLength),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive().max(ATTACHMENT_LIMITS.documentMaxBytes),
    width: z.number().int().positive().optional().nullable(),
    height: z.number().int().positive().optional().nullable(),
  })
  .strict();

export const widgetInitiateUploadsRequestSchema = z
  .object({
    embedToken: z.string().min(1),
    files: z.array(attachmentUploadFileSchema).min(1).max(ATTACHMENT_LIMITS.maxFilesPerMessage),
    body: z.string().max(4000).optional().default(""),
    clientMessageId: z.string().uuid().optional(),
    pageUrl: z
      .string()
      .max(2048)
      .optional()
      .nullable()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return sanitizePageUrl(value);
      }),
    referrer: z
      .string()
      .max(2048)
      .optional()
      .nullable()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return sanitizeReferrer(value);
      }),
  })
  .strict();

export type WidgetInitiateUploadsRequest = z.infer<typeof widgetInitiateUploadsRequestSchema>;

export const operatorInitiateUploadsRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    files: z.array(attachmentUploadFileSchema).min(1).max(ATTACHMENT_LIMITS.maxFilesPerMessage),
    body: z.string().max(4000).optional().default(""),
    clientMessageId: z.string().uuid().optional(),
  })
  .strict();

export type OperatorInitiateUploadsRequest = z.infer<typeof operatorInitiateUploadsRequestSchema>;

export const initiatedUploadSchema = z
  .object({
    localId: z.string().min(1).max(64),
    uploadId: z.string().uuid(),
    attachmentId: z.string().uuid(),
    storageKey: z.string().min(1),
    uploadUrl: z.string().url(),
    uploadToken: z.string().nullable(),
    expiresAt: z.string(),
    headers: z.record(z.string()).optional(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    kind: attachmentKindSchema,
  })
  .strict();

export const initiateUploadsDataSchema = z
  .object({
    batchId: z.string().uuid(),
    conversationId: z.string().uuid(),
    uploads: z.array(initiatedUploadSchema).min(1),
  })
  .strict();

export type InitiateUploadsData = z.infer<typeof initiateUploadsDataSchema>;

export const completeUploadsRequestSchema = z
  .object({
    embedToken: z.string().min(1).optional(),
    batchId: z.string().uuid(),
    uploadIds: z.array(z.string().uuid()).min(1).max(ATTACHMENT_LIMITS.maxFilesPerMessage),
    body: z.string().max(4000).optional().default(""),
    clientMessageId: z.string().uuid().optional(),
    pageUrl: z
      .string()
      .max(2048)
      .optional()
      .nullable()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return sanitizePageUrl(value);
      }),
    referrer: z
      .string()
      .max(2048)
      .optional()
      .nullable()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return sanitizeReferrer(value);
      }),
  })
  .strict();

export type CompleteUploadsRequest = z.infer<typeof completeUploadsRequestSchema>;

export const cancelUploadsRequestSchema = z
  .object({
    embedToken: z.string().min(1).optional(),
    batchId: z.string().uuid(),
    uploadIds: z
      .array(z.string().uuid())
      .min(1)
      .max(ATTACHMENT_LIMITS.maxFilesPerMessage)
      .optional(),
  })
  .strict();

export type CancelUploadsRequest = z.infer<typeof cancelUploadsRequestSchema>;

export const attachmentDownloadDataSchema = z
  .object({
    url: z.string().url(),
    expiresAt: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    contentDisposition: z.string(),
  })
  .strict();

export type AttachmentDownloadData = z.infer<typeof attachmentDownloadDataSchema>;
