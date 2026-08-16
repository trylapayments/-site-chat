import { z } from "zod";

export const CANNED_TITLE_MAX_LENGTH = 200;
export const CANNED_BODY_MAX_LENGTH = 4000;
export const CANNED_FOLDER_NAME_MAX_LENGTH = 100;
export const CANNED_SHORTCUT_MAX_LENGTH = 64;
export const CANNED_SEARCH_MAX_LENGTH = 200;
export const CANNED_FOLDER_SORT_ORDER_MIN = -100_000;
export const CANNED_FOLDER_SORT_ORDER_MAX = 100_000;

export const CANNED_DEFAULT_PAGE_SIZE = 100;
export const CANNED_MAX_PAGE_SIZE = 200;
export const CANNED_FOLDER_DEFAULT_PAGE_SIZE = 200;
export const CANNED_FOLDER_MAX_PAGE_SIZE = 500;

/**
 * Shortcuts are stored slash-free and lowercase, matching
 * `chk_canned_responses_shortcut_format` / `normalize_canned_shortcut`.
 */
export const CANNED_SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const cannedVisibilitySchema = z.enum(["workspace", "personal"]);

export type CannedVisibility = z.infer<typeof cannedVisibilitySchema>;

export const cannedVisibilityFilterSchema = z.enum(["all", "workspace", "personal"]);

export type CannedVisibilityFilter = z.infer<typeof cannedVisibilityFilterSchema>;

const displayLabelSchema = z.string().min(1).max(200);

/** Matches `app_private.build_canned_response_item`. */
export const cannedResponseSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    visibility: cannedVisibilitySchema,
    owner_member_id: z.string().uuid().nullable(),
    owner_display_label: displayLabelSchema.nullable(),
    folder_id: z.string().uuid().nullable(),
    title: z.string().min(1).max(CANNED_TITLE_MAX_LENGTH),
    body: z.string().min(1).max(CANNED_BODY_MAX_LENGTH),
    shortcut: z.string().max(CANNED_SHORTCUT_MAX_LENGTH).nullable(),
    usage_count: z.number().int().nonnegative(),
    is_favorited: z.boolean(),
    created_by: z.string().uuid().nullable(),
    created_by_display_label: displayLabelSchema.nullable(),
    updated_by: z.string().uuid().nullable(),
    updated_by_display_label: displayLabelSchema.nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
    deleted_at: z.string().nullable().optional(),
  })
  .strict();

export type CannedResponse = z.infer<typeof cannedResponseSchema>;

/** Matches `app_private.build_canned_folder_item`. */
export const cannedFolderSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    visibility: cannedVisibilitySchema,
    owner_member_id: z.string().uuid().nullable(),
    owner_display_label: displayLabelSchema.nullable(),
    name: z.string().min(1).max(CANNED_FOLDER_NAME_MAX_LENGTH),
    sort_order: z.number().int(),
    response_count: z.number().int().nonnegative(),
    created_by: z.string().uuid().nullable(),
    created_by_display_label: displayLabelSchema.nullable(),
    updated_by: z.string().uuid().nullable(),
    updated_by_display_label: displayLabelSchema.nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
    deleted_at: z.string().nullable().optional(),
  })
  .strict();

export type CannedFolder = z.infer<typeof cannedFolderSchema>;

export const listCannedResponsesResultSchema = z
  .object({
    items: z.array(cannedResponseSchema),
    /** Omitted entirely when the query passed `include_folders: false`. */
    folders: z.array(cannedFolderSchema).optional(),
    tombstones: z.array(cannedResponseSchema).optional().default([]),
    /** The page was truncated at `limit`; narrow with q / folder / visibility. */
    has_more: z.boolean(),
    authoritative: z.boolean().optional().default(false),
    /**
     * Postgres-side catch-up cursor: MAX(catch_up_since, returned updated_at).
     * Clients advance only from this / returned row times — never Date.now().
     */
    server_watermark: z.string().min(1).nullable().optional(),
  })
  .strict();

export type ListCannedResponsesResult = z.infer<typeof listCannedResponsesResultSchema>;

export const listCannedFoldersResultSchema = z
  .object({
    items: z.array(cannedFolderSchema),
    tombstones: z.array(cannedFolderSchema).optional().default([]),
    has_more: z.boolean(),
    authoritative: z.boolean().optional().default(false),
    server_watermark: z.string().min(1).nullable().optional(),
  })
  .strict();

export type ListCannedFoldersResult = z.infer<typeof listCannedFoldersResultSchema>;

/** `"none"` selects unfiled snippets only; absent means "any folder". */
export const cannedFolderFilterSchema = z.union([z.string().uuid(), z.literal("none")]);

export type CannedFolderFilter = z.infer<typeof cannedFolderFilterSchema>;

export const listCannedResponsesQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(CANNED_MAX_PAGE_SIZE)
      .optional()
      .default(CANNED_DEFAULT_PAGE_SIZE),
    q: z.string().trim().max(CANNED_SEARCH_MAX_LENGTH).optional(),
    folder_id: cannedFolderFilterSchema.optional(),
    visibility: cannedVisibilityFilterSchema.optional().default("all"),
    favorites_only: z.boolean().optional().default(false),
    include_folders: z.boolean().optional().default(true),
    /** Soft-delete tombstones + snippets updated at/after this watermark. */
    catch_up_since: z.string().min(1).optional(),
    /** Reconnect: return the full top page regardless of `catch_up_since`. */
    authoritative: z.boolean().optional().default(false),
  })
  .strict();

export type ListCannedResponsesQuery = z.input<typeof listCannedResponsesQuerySchema>;
export type ListCannedResponsesQueryParsed = z.output<typeof listCannedResponsesQuerySchema>;

export const listCannedFoldersQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(CANNED_FOLDER_MAX_PAGE_SIZE)
      .optional()
      .default(CANNED_FOLDER_DEFAULT_PAGE_SIZE),
    visibility: cannedVisibilityFilterSchema.optional().default("all"),
    catch_up_since: z.string().min(1).optional(),
    authoritative: z.boolean().optional().default(false),
  })
  .strict();

export type ListCannedFoldersQuery = z.input<typeof listCannedFoldersQuerySchema>;
export type ListCannedFoldersQueryParsed = z.output<typeof listCannedFoldersQuerySchema>;

/**
 * Shortcut input accepts what the operator typed (`/refund`, `Refund`), and is
 * normalized to storage form before validation.
 */
const shortcutInputSchema = z
  .string()
  .max(CANNED_SHORTCUT_MAX_LENGTH + 1)
  .transform((value) => value.trim().replace(/^\/+/, "").trim().toLowerCase())
  .refine((value) => value === "" || CANNED_SHORTCUT_PATTERN.test(value), {
    message:
      "Shortcut must use lowercase letters, digits, hyphen or underscore and start with a letter or digit.",
  })
  .transform((value) => (value === "" ? null : value));

export const createCannedResponseSchema = z
  .object({
    title: z.string().trim().min(1).max(CANNED_TITLE_MAX_LENGTH),
    body: z.string().trim().min(1).max(CANNED_BODY_MAX_LENGTH),
    shortcut: shortcutInputSchema.nullable().optional().default(null),
    visibility: cannedVisibilitySchema.optional().default("workspace"),
    folderId: z.string().uuid().nullable().optional().default(null),
  })
  .strict();

export type CreateCannedResponseInput = z.input<typeof createCannedResponseSchema>;
export type CreateCannedResponseParsed = z.output<typeof createCannedResponseSchema>;

export const updateCannedResponseSchema = z
  .object({
    cannedResponseId: z.string().uuid(),
    title: z.string().trim().min(1).max(CANNED_TITLE_MAX_LENGTH),
    body: z.string().trim().min(1).max(CANNED_BODY_MAX_LENGTH),
    shortcut: shortcutInputSchema.nullable().optional().default(null),
    folderId: z.string().uuid().nullable().optional().default(null),
  })
  .strict();

export type UpdateCannedResponseInput = z.input<typeof updateCannedResponseSchema>;
export type UpdateCannedResponseParsed = z.output<typeof updateCannedResponseSchema>;

export const softDeleteCannedResponseSchema = z
  .object({
    cannedResponseId: z.string().uuid(),
  })
  .strict();

export type SoftDeleteCannedResponseInput = z.infer<typeof softDeleteCannedResponseSchema>;

export const setCannedResponseFavoriteSchema = z
  .object({
    cannedResponseId: z.string().uuid(),
    favorited: z.boolean(),
  })
  .strict();

export type SetCannedResponseFavoriteInput = z.infer<typeof setCannedResponseFavoriteSchema>;

export const recordCannedResponseUsageSchema = z
  .object({
    cannedResponseId: z.string().uuid(),
  })
  .strict();

export type RecordCannedResponseUsageInput = z.infer<typeof recordCannedResponseUsageSchema>;

const sortOrderSchema = z
  .number()
  .int()
  .min(CANNED_FOLDER_SORT_ORDER_MIN)
  .max(CANNED_FOLDER_SORT_ORDER_MAX);

export const createCannedFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(CANNED_FOLDER_NAME_MAX_LENGTH),
    visibility: cannedVisibilitySchema.optional().default("workspace"),
    sortOrder: sortOrderSchema.optional().default(0),
  })
  .strict();

export type CreateCannedFolderInput = z.input<typeof createCannedFolderSchema>;
export type CreateCannedFolderParsed = z.output<typeof createCannedFolderSchema>;

export const updateCannedFolderSchema = z
  .object({
    folderId: z.string().uuid(),
    name: z.string().trim().min(1).max(CANNED_FOLDER_NAME_MAX_LENGTH),
    sortOrder: sortOrderSchema.optional().default(0),
  })
  .strict();

export type UpdateCannedFolderInput = z.input<typeof updateCannedFolderSchema>;
export type UpdateCannedFolderParsed = z.output<typeof updateCannedFolderSchema>;

export const softDeleteCannedFolderSchema = z
  .object({
    folderId: z.string().uuid(),
  })
  .strict();

export type SoftDeleteCannedFolderInput = z.infer<typeof softDeleteCannedFolderSchema>;
