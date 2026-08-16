import { z } from "zod";

import { sanitizeAttachmentFilename } from "../attachments/filename.js";
import {
  CUSTOMER_TIMELINE_ACTOR_TYPES,
  CUSTOMER_TIMELINE_DEFAULT_PAGE_SIZE,
  CUSTOMER_TIMELINE_EVENT_TYPES,
  CUSTOMER_TIMELINE_MAX_PAGE_SIZE,
  CUSTOMER_TIMELINE_METADATA_VERSION,
} from "../timeline/constants.js";
import { parseTimelineCursor } from "../timeline/pagination.js";

/**
 * Compact, versioned timeline metadata.
 * Forbidden: signed URLs, continuity tokens, auth secrets, message bodies,
 * raw AI prompts, internal hashes.
 */
const timelineMetaBase = z
  .object({
    v: z.literal(CUSTOMER_TIMELINE_METADATA_VERSION).default(CUSTOMER_TIMELINE_METADATA_VERSION),
  })
  .passthrough();

export const pageViewedMetadataSchema = timelineMetaBase
  .extend({
    url: z.string().max(2048),
    title: z.string().max(500).nullable().optional(),
    page_view_id: z.string().uuid().optional(),
  })
  .strict();

export const conversationStartedMetadataSchema = timelineMetaBase
  .extend({
    channel_type: z.string().max(32).optional(),
  })
  .strict();

export const messageSentMetadataSchema = timelineMetaBase
  .extend({
    message_id: z.string().uuid(),
    client_message_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const attachmentUploadedMetadataSchema = timelineMetaBase
  .extend({
    message_id: z.string().uuid(),
    filename: z.string().max(255),
    mime_type: z.string().max(127).optional(),
    kind: z.enum(["image", "document"]).optional(),
    attachment_count: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const safe = sanitizeAttachmentFilename(value.filename);
    if (!safe) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid filename",
        path: ["filename"],
      });
    }
  });

export const identityChangeSchema = z
  .object({
    field: z.enum(["name", "email", "phone", "job_title", "locale", "country_code"]),
    from: z.union([z.string().max(254), z.null()]).optional(),
    to: z.union([z.string().max(254), z.null()]).optional(),
  })
  .strict();

export const visitorIdentifiedMetadataSchema = timelineMetaBase
  .extend({
    name: z.string().max(120).nullable().optional(),
    email: z.string().max(254).nullable().optional(),
    phone: z.string().max(64).nullable().optional(),
    changes: z.array(identityChangeSchema).max(8).optional(),
  })
  .strict();

export const visitorProfileUpdatedMetadataSchema = timelineMetaBase
  .extend({
    changes: z.array(identityChangeSchema).min(1).max(8),
    source: z.enum(["operator", "host", "visitor"]).optional(),
  })
  .strict();

export const tagAddedMetadataSchema = timelineMetaBase
  .extend({
    tag_id: z.string().uuid(),
    tag_name: z.string().max(64),
    tag_color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .strict();

export const tagRemovedMetadataSchema = timelineMetaBase
  .extend({
    tag_id: z.string().uuid(),
    tag_name: z.string().max(64),
    source: z.enum(["unassign", "tag_deleted"]).optional(),
  })
  .strict();

export const companyLinkedMetadataSchema = timelineMetaBase
  .extend({
    company_id: z.string().uuid(),
    previous_company_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const companyUnlinkedMetadataSchema = timelineMetaBase
  .extend({
    previous_company_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const customFieldUpdatedMetadataSchema = timelineMetaBase
  .extend({
    field_id: z.string().uuid(),
    key: z.string().max(64),
    field_type: z.enum(["text", "number", "boolean", "date", "select"]),
    from: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    to: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  })
  .strict();

export const conversationStatusChangedMetadataSchema = timelineMetaBase
  .extend({
    from_status: z.string().max(32).nullable().optional(),
    to_status: z.string().max(32),
  })
  .strict();

export const conversationAssignedMetadataSchema = timelineMetaBase
  .extend({
    from_member_id: z.string().uuid().nullable().optional(),
    from_member_label: z.string().max(200).nullable().optional(),
    to_member_id: z.string().uuid().nullable().optional(),
    to_member_label: z.string().max(200).nullable().optional(),
    /** @deprecated Prefer to_member_id — kept for backward-compatible rows. */
    assignee_member_id: z.string().uuid().nullable().optional(),
    /** @deprecated Prefer to_member_label */
    assignee_label: z.string().max(200).nullable().optional(),
    /** @deprecated Prefer from_member_id */
    previous_assignee_member_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const conversationTransferredMetadataSchema = conversationAssignedMetadataSchema;
export const conversationUnassignedMetadataSchema = conversationAssignedMetadataSchema;

export const internalNoteTimelineMetadataSchema = timelineMetaBase
  .extend({
    note_id: z.string().uuid(),
    author_member_id: z.string().uuid().nullable().optional(),
    author_member_label: z.string().max(200).nullable().optional(),
    updated_by_member_id: z.string().uuid().nullable().optional(),
    updated_by_member_label: z.string().max(200).nullable().optional(),
    deleted_by_member_id: z.string().uuid().nullable().optional(),
    deleted_by_member_label: z.string().max(200).nullable().optional(),
  })
  .strict();

export const mentionCreatedMetadataSchema = timelineMetaBase
  .extend({
    note_id: z.string().uuid(),
    mentioned_member_id: z.string().uuid(),
    mentioned_member_label: z.string().max(200).nullable().optional(),
    author_member_id: z.string().uuid().nullable().optional(),
    author_member_label: z.string().max(200).nullable().optional(),
  })
  .strict();

export const customerTimelineEventTypeSchema = z.enum(CUSTOMER_TIMELINE_EVENT_TYPES);
export const customerTimelineActorTypeSchema = z.enum(CUSTOMER_TIMELINE_ACTOR_TYPES);

export const customerTimelineMetadataSchema = z.record(z.string(), z.unknown());

export const customerTimelineEventSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    contact_id: z.string().uuid(),
    visitor_session_id: z.string().uuid().nullable(),
    conversation_id: z.string().uuid().nullable(),
    event_type: customerTimelineEventTypeSchema,
    actor_type: customerTimelineActorTypeSchema,
    actor_member_id: z.string().uuid().nullable(),
    metadata_json: customerTimelineMetadataSchema,
    occurred_at: z.string().min(1),
    created_at: z.string().min(1),
    dedupe_key: z.string().max(256).nullable().optional(),
  })
  .strict();

export type CustomerTimelineEvent = z.infer<typeof customerTimelineEventSchema>;

export const listCustomerTimelineQuerySchema = z
  .object({
    contact_id: z.string().uuid(),
    conversation_id: z.string().uuid().optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(CUSTOMER_TIMELINE_MAX_PAGE_SIZE)
      .optional()
      .default(CUSTOMER_TIMELINE_DEFAULT_PAGE_SIZE),
    /** Load events strictly older than this keyset cursor. */
    before: z
      .object({
        occurred_at: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.before && !parseTimelineCursor(value.before)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid before cursor",
        path: ["before"],
      });
    }
  });

export type ListCustomerTimelineQuery = z.infer<typeof listCustomerTimelineQuerySchema>;

export const listCustomerTimelineResultSchema = z
  .object({
    events: z.array(customerTimelineEventSchema),
    next_before: z
      .object({
        occurred_at: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .nullable(),
    has_more: z.boolean(),
  })
  .strict();

export type ListCustomerTimelineResult = z.infer<typeof listCustomerTimelineResultSchema>;

/** Forbidden metadata keys that must never appear in persisted timeline payloads. */
export const TIMELINE_FORBIDDEN_METADATA_KEYS = [
  "continuity_token",
  "continuity_token_hash",
  "session_token",
  "access_token",
  "refresh_token",
  "signed_url",
  "signedUrl",
  "download_url",
  "upload_url",
  "authorization",
  "password",
  "secret",
  "api_key",
  "apiKey",
  "prompt",
  "raw_prompt",
  "body",
  "message_body",
] as const;

export function assertSafeTimelineMetadata(metadata: Record<string, unknown>): void {
  for (const key of Object.keys(metadata)) {
    const lower = key.toLowerCase();
    for (const forbidden of TIMELINE_FORBIDDEN_METADATA_KEYS) {
      if (
        lower === forbidden.toLowerCase() ||
        lower.includes("token") ||
        lower.includes("secret")
      ) {
        throw new Error(`Forbidden timeline metadata key: ${key}`);
      }
    }
  }
  if ("url" in metadata && typeof metadata.url === "string") {
    if (metadata.url.includes("#") || /[?&](?!utm_)[^=]+=/.test(metadata.url)) {
      // Allow only if no non-utm query — soft check for tests; SQL sanitizer is source of truth.
      const qIndex = metadata.url.indexOf("?");
      if (qIndex >= 0) {
        const query = metadata.url.slice(qIndex + 1);
        for (const part of query.split("&")) {
          const name = part.split("=")[0]?.toLowerCase() ?? "";
          if (
            name &&
            !["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(name)
          ) {
            throw new Error("Timeline URL metadata must be sanitized");
          }
        }
      }
      if (metadata.url.includes("#")) {
        throw new Error("Timeline URL metadata must not include fragments");
      }
    }
  }
}
