import { z } from "zod";

export const GLOBAL_SEARCH_QUERY_MAX_LENGTH = 200;
export const GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE = 5;
export const GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE = 25;
export const GLOBAL_SEARCH_DEBOUNCE_MS = 200;

export const GLOBAL_SEARCH_CATEGORIES = [
  "all",
  "contacts",
  "conversations",
  "messages",
  "notes",
  "attachments",
] as const;

export type GlobalSearchCategory = (typeof GLOBAL_SEARCH_CATEGORIES)[number];

export const GLOBAL_SEARCH_RESULT_TYPES = [
  "contact",
  "conversation",
  "message",
  "note",
  "attachment",
] as const;

export type GlobalSearchResultType = (typeof GLOBAL_SEARCH_RESULT_TYPES)[number];

export const globalSearchCategorySchema = z.enum(GLOBAL_SEARCH_CATEGORIES);

export const globalSearchResultTypeSchema = z.enum(GLOBAL_SEARCH_RESULT_TYPES);

export const globalSearchQuerySchema = z
  .object({
    q: z.string().trim().max(GLOBAL_SEARCH_QUERY_MAX_LENGTH).default(""),
    category: globalSearchCategorySchema.default("all"),
    limit_per_type: z
      .number()
      .int()
      .min(1)
      .max(GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE)
      .optional()
      .default(GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE),
  })
  .strict();

export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

export const globalSearchHitSchema = z
  .object({
    type: globalSearchResultTypeSchema,
    id: z.string().uuid(),
    title: z.string().min(0).max(500),
    subtitle: z.string().max(500).nullable(),
    snippet: z.string().max(500).nullable(),
    timestamp: z.string().nullable(),
    conversation_id: z.string().uuid().nullable(),
    contact_id: z.string().uuid().nullable(),
    message_id: z.string().uuid().nullable(),
    rank: z.number(),
  })
  .strict();

export type GlobalSearchHit = z.infer<typeof globalSearchHitSchema>;

export const globalSearchGroupsSchema = z
  .object({
    contacts: z.array(globalSearchHitSchema),
    conversations: z.array(globalSearchHitSchema),
    messages: z.array(globalSearchHitSchema),
    notes: z.array(globalSearchHitSchema),
    attachments: z.array(globalSearchHitSchema),
  })
  .strict();

export type GlobalSearchGroups = z.infer<typeof globalSearchGroupsSchema>;

export const globalSearchResultSchema = z
  .object({
    q: z.string().max(GLOBAL_SEARCH_QUERY_MAX_LENGTH),
    category: globalSearchCategorySchema,
    limit_per_type: z.number().int().min(1).max(GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE),
    can_search_notes: z.boolean(),
    groups: globalSearchGroupsSchema,
  })
  .strict();

export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const EMPTY_GLOBAL_SEARCH_GROUPS: GlobalSearchGroups = {
  contacts: [],
  conversations: [],
  messages: [],
  notes: [],
  attachments: [],
};

export function emptyGlobalSearchResult(
  query: Partial<GlobalSearchQuery> & { can_search_notes?: boolean } = {},
): GlobalSearchResult {
  return {
    q: query.q ?? "",
    category: query.category ?? "all",
    limit_per_type: query.limit_per_type ?? GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE,
    can_search_notes: query.can_search_notes ?? true,
    groups: { ...EMPTY_GLOBAL_SEARCH_GROUPS },
  };
}
