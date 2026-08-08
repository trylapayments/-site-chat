/**
 * Ephemeral Realtime events for attachment upload lifecycle.
 * Delivered on `widget-ephemeral:{topic_key}` — never authoritative.
 * Durable authority remains message.created + HTTP catch-up.
 */

import { z } from "zod";

import { ephemeralActorRoleSchema } from "../realtime/ephemeral.js";
import { attachmentKindSchema, messageAttachmentViewSchema } from "../schemas/attachments.js";

export const UPLOAD_BROADCAST_EVENT = "upload.v1" as const;

export const uploadBroadcastStateSchema = z.enum(["started", "completed", "failed", "cancelled"]);

export type UploadBroadcastState = z.infer<typeof uploadBroadcastStateSchema>;

export const uploadBroadcastPayloadSchema = z
  .object({
    v: z.literal(1),
    actorRole: ephemeralActorRoleSchema,
    actorKey: z.string().min(1).max(128),
    state: uploadBroadcastStateSchema,
    batchId: z.string().uuid(),
    conversationId: z.string().uuid(),
    clientMessageId: z.string().uuid().nullable().optional(),
    uploadIds: z.array(z.string().uuid()).max(10).optional(),
    filenames: z.array(z.string().max(255)).max(10).optional(),
    kinds: z.array(attachmentKindSchema).max(10).optional(),
    errorCode: z.string().max(64).nullable().optional(),
    /** Present on completed — compact attachment views for optimistic UI. */
    attachments: z.array(messageAttachmentViewSchema).max(10).optional(),
    messageId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type UploadBroadcastPayload = z.infer<typeof uploadBroadcastPayloadSchema>;

export function parseUploadBroadcastPayload(raw: unknown): UploadBroadcastPayload | null {
  const parsed = uploadBroadcastPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function createUploadBroadcastPayload(
  input: Omit<UploadBroadcastPayload, "v">,
): UploadBroadcastPayload {
  return uploadBroadcastPayloadSchema.parse({ v: 1, ...input });
}
