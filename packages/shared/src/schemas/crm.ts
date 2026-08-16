import { z } from "zod";

import {
  COMPANY_DOMAIN_MAX_LENGTH,
  COMPANY_INDUSTRY_MAX_LENGTH,
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_SIZES,
  COMPANY_WEBSITE_MAX_LENGTH,
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_JOB_TITLE_MAX_LENGTH,
  CONTACT_LOCALE_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  CONTACT_SEARCH_MAX_LENGTH,
  CONTACT_TAG_COLOR_DEFAULT,
  CONTACT_TAG_COLOR_PATTERN,
  CONTACT_TAG_NAME_MAX_LENGTH,
  CUSTOM_FIELD_KEY_MAX_LENGTH,
  CUSTOM_FIELD_KEY_PATTERN,
  CUSTOM_FIELD_LABEL_MAX_LENGTH,
  CUSTOM_FIELD_OPTION_MAX_LENGTH,
  CUSTOM_FIELD_OPTIONS_MAX,
  CUSTOM_FIELD_SORT_ORDER_MAX,
  CUSTOM_FIELD_SORT_ORDER_MIN,
  CUSTOM_FIELD_TEXT_VALUE_MAX_LENGTH,
  CUSTOM_FIELD_TYPES,
  LIST_COMPANIES_DEFAULT_PAGE_SIZE,
  LIST_COMPANIES_MAX_PAGE_SIZE,
  LIST_CONTACTS_DEFAULT_PAGE_SIZE,
  LIST_CONTACTS_MAX_PAGE_SIZE,
} from "../crm/constants.js";

export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const companySizeSchema = z.enum(COMPANY_SIZES);
export type CompanySize = z.infer<typeof companySizeSchema>;

const visitorPublicIdSchema = z
  .string()
  .regex(/^vis_[a-f0-9]{32}$/)
  .nullable();

const isoTimestampSchema = z.string().min(1);

/** Matches `app_private.company_json`. */
export const companySummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(COMPANY_NAME_MAX_LENGTH),
    domain: z.string().max(COMPANY_DOMAIN_MAX_LENGTH).nullable(),
    website: z.string().max(COMPANY_WEBSITE_MAX_LENGTH).nullable(),
    industry: z.string().max(COMPANY_INDUSTRY_MAX_LENGTH).nullable(),
    size: companySizeSchema.nullable(),
  })
  .strict();

export type CompanySummary = z.infer<typeof companySummarySchema>;

/** Company list/detail rows include timestamps + contact_count. */
export const companySchema = companySummarySchema
  .extend({
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    deleted_at: isoTimestampSchema.nullable().optional(),
    contact_count: z.number().int().nonnegative(),
  })
  .strict();

export type Company = z.infer<typeof companySchema>;

/** Matches `app_private.contact_tag_json` (profile / list item chips). */
export const contactTagSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(CONTACT_TAG_NAME_MAX_LENGTH),
    color: z.string().regex(CONTACT_TAG_COLOR_PATTERN),
  })
  .strict();

export type ContactTagSummary = z.infer<typeof contactTagSummarySchema>;

/** Tag definition rows from `list_contact_tags` / create / update. */
export const contactTagSchema = contactTagSummarySchema
  .extend({
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    deleted_at: isoTimestampSchema.nullable(),
  })
  .strict();

export type ContactTag = z.infer<typeof contactTagSchema>;

export const customFieldOptionsSchema = z
  .array(z.string().min(1).max(CUSTOM_FIELD_OPTION_MAX_LENGTH))
  .max(CUSTOM_FIELD_OPTIONS_MAX);

/** Matches `app_private.custom_field_definition_json`. */
export const customFieldDefinitionSchema = z
  .object({
    id: z.string().uuid(),
    key: z.string().min(1).max(CUSTOM_FIELD_KEY_MAX_LENGTH),
    label: z.string().min(1).max(CUSTOM_FIELD_LABEL_MAX_LENGTH),
    field_type: customFieldTypeSchema,
    options: customFieldOptionsSchema,
    sort_order: z.number().int(),
    is_required: z.boolean(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    deleted_at: isoTimestampSchema.nullable(),
  })
  .strict();

export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const customFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

/** Entry in `build_contact_profile.custom_fields`. */
export const contactCustomFieldEntrySchema = z
  .object({
    field_id: z.string().uuid(),
    key: z.string().min(1).max(CUSTOM_FIELD_KEY_MAX_LENGTH),
    label: z.string().min(1).max(CUSTOM_FIELD_LABEL_MAX_LENGTH),
    field_type: customFieldTypeSchema,
    options: customFieldOptionsSchema,
    value: customFieldValueSchema,
  })
  .strict();

export type ContactCustomFieldEntry = z.infer<typeof contactCustomFieldEntrySchema>;

export const contactAssigneeSchema = z
  .object({
    member_id: z.string().uuid(),
    display_label: z.string().min(1).max(200),
  })
  .strict();

export type ContactAssignee = z.infer<typeof contactAssigneeSchema>;

export const contactDeviceSummarySchema = z
  .object({
    device_type: z.string().nullable(),
    browser_family: z.string().nullable(),
    browser_version: z.string().nullable(),
    os_family: z.string().nullable(),
  })
  .strict();

export type ContactDeviceSummary = z.infer<typeof contactDeviceSummarySchema>;

/** Matches `app_private.build_contact_profile` / `get_contact_profile`. */
export const contactProfileSchema = z
  .object({
    id: z.string().uuid(),
    public_id: visitorPublicIdSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    job_title: z.string().nullable(),
    locale: z.string().nullable(),
    country_code: z.string().nullable(),
    attributes: z.record(z.string(), z.unknown()).default({}),
    first_seen_at: isoTimestampSchema,
    last_seen_at: isoTimestampSchema,
    visit_count: z.number().int().nonnegative(),
    conversation_count: z.number().int().nonnegative(),
    attachment_count: z.number().int().nonnegative(),
    company: companySummarySchema.nullable(),
    tags: z.array(contactTagSummarySchema),
    custom_fields: z.array(contactCustomFieldEntrySchema),
    current_assignee: contactAssigneeSchema.nullable(),
    device_summary: contactDeviceSummarySchema.nullable(),
    updated_at: isoTimestampSchema,
  })
  .strict();

export type ContactProfile = z.infer<typeof contactProfileSchema>;

/** Matches `app_private.contact_list_item_json`. */
export const contactListItemSchema = z
  .object({
    id: z.string().uuid(),
    public_id: visitorPublicIdSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    job_title: z.string().nullable(),
    locale: z.string().nullable(),
    country_code: z.string().nullable(),
    company: companySummarySchema.nullable(),
    tags: z.array(contactTagSummarySchema),
    first_seen_at: isoTimestampSchema,
    last_seen_at: isoTimestampSchema,
    visit_count: z.number().int().nonnegative(),
    updated_at: isoTimestampSchema,
  })
  .strict();

export type ContactListItem = z.infer<typeof contactListItemSchema>;

export const listContactsQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIST_CONTACTS_MAX_PAGE_SIZE)
      .optional()
      .default(LIST_CONTACTS_DEFAULT_PAGE_SIZE),
    q: z.string().trim().max(CONTACT_SEARCH_MAX_LENGTH).optional(),
    company_id: z.string().uuid().optional(),
    tag_ids: z.array(z.string().uuid()).max(50).optional(),
    before: z
      .object({
        last_seen_at: isoTimestampSchema,
        id: z.string().uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ListContactsQuery = z.input<typeof listContactsQuerySchema>;
export type ListContactsQueryParsed = z.output<typeof listContactsQuerySchema>;

export const listContactsResultSchema = z
  .object({
    items: z.array(contactListItemSchema),
    next_before: z
      .object({
        last_seen_at: isoTimestampSchema,
        id: z.string().uuid(),
      })
      .strict()
      .nullable(),
    has_more: z.boolean(),
  })
  .strict();

export type ListContactsResult = z.infer<typeof listContactsResultSchema>;

export const listContactTagsQuerySchema = z
  .object({
    q: z.string().trim().max(CONTACT_SEARCH_MAX_LENGTH).optional(),
    include_deleted: z.boolean().optional().default(false),
  })
  .strict();

export type ListContactTagsQuery = z.input<typeof listContactTagsQuerySchema>;

export const listContactTagsResultSchema = z
  .object({
    items: z.array(contactTagSchema),
  })
  .strict();

export type ListContactTagsResult = z.infer<typeof listContactTagsResultSchema>;

export const listCompaniesQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIST_COMPANIES_MAX_PAGE_SIZE)
      .optional()
      .default(LIST_COMPANIES_DEFAULT_PAGE_SIZE),
    q: z.string().trim().max(CONTACT_SEARCH_MAX_LENGTH).optional(),
    before: z
      .object({
        name: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ListCompaniesQuery = z.input<typeof listCompaniesQuerySchema>;

export const listCompaniesResultSchema = z
  .object({
    items: z.array(companySchema),
    next_before: z
      .object({
        name: z.string().min(1),
        id: z.string().uuid(),
      })
      .strict()
      .nullable(),
    has_more: z.boolean(),
  })
  .strict();

export type ListCompaniesResult = z.infer<typeof listCompaniesResultSchema>;

export const listCustomFieldDefinitionsResultSchema = z
  .object({
    items: z.array(customFieldDefinitionSchema),
  })
  .strict();

export type ListCustomFieldDefinitionsResult = z.infer<
  typeof listCustomFieldDefinitionsResultSchema
>;

const nullableTrimmed = (max: number) => z.union([z.string().trim().max(max), z.null()]);

/** Operator patch for `update_contact_profile`. */
export const updateContactProfileSchema = z
  .object({
    contactId: z.string().uuid(),
    name: nullableTrimmed(CONTACT_NAME_MAX_LENGTH).optional(),
    email: nullableTrimmed(CONTACT_EMAIL_MAX_LENGTH).optional(),
    phone: nullableTrimmed(CONTACT_PHONE_MAX_LENGTH).optional(),
    job_title: nullableTrimmed(CONTACT_JOB_TITLE_MAX_LENGTH).optional(),
    locale: nullableTrimmed(CONTACT_LOCALE_MAX_LENGTH).optional(),
    country_code: z.union([z.string().length(2), z.null()]).optional(),
    company_id: z.union([z.string().uuid(), z.null()]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.name === undefined &&
      value.email === undefined &&
      value.phone === undefined &&
      value.job_title === undefined &&
      value.locale === undefined &&
      value.country_code === undefined &&
      value.company_id === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
    }
  });

export type UpdateContactProfileInput = z.infer<typeof updateContactProfileSchema>;

export const createContactTagSchema = z
  .object({
    name: z.string().trim().min(1).max(CONTACT_TAG_NAME_MAX_LENGTH),
    color: z
      .string()
      .regex(CONTACT_TAG_COLOR_PATTERN)
      .optional()
      .default(CONTACT_TAG_COLOR_DEFAULT),
  })
  .strict();

export type CreateContactTagInput = z.infer<typeof createContactTagSchema>;

export const updateContactTagSchema = z
  .object({
    tagId: z.string().uuid(),
    name: z.string().trim().min(1).max(CONTACT_TAG_NAME_MAX_LENGTH).optional(),
    color: z.string().regex(CONTACT_TAG_COLOR_PATTERN).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.name === undefined && value.color === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
    }
  });

export type UpdateContactTagInput = z.infer<typeof updateContactTagSchema>;

export const softDeleteContactTagSchema = z
  .object({
    tagId: z.string().uuid(),
  })
  .strict();

export type SoftDeleteContactTagInput = z.infer<typeof softDeleteContactTagSchema>;

export const assignContactTagSchema = z
  .object({
    contactId: z.string().uuid(),
    tagId: z.string().uuid(),
  })
  .strict();

export type AssignContactTagInput = z.infer<typeof assignContactTagSchema>;

export const unassignContactTagSchema = assignContactTagSchema;
export type UnassignContactTagInput = z.infer<typeof unassignContactTagSchema>;

export const createCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH),
    domain: nullableTrimmed(COMPANY_DOMAIN_MAX_LENGTH).optional(),
    website: nullableTrimmed(COMPANY_WEBSITE_MAX_LENGTH).optional(),
    industry: nullableTrimmed(COMPANY_INDUSTRY_MAX_LENGTH).optional(),
    size: z.union([companySizeSchema, z.null()]).optional(),
  })
  .strict();

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .object({
    companyId: z.string().uuid(),
    name: z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH).optional(),
    domain: nullableTrimmed(COMPANY_DOMAIN_MAX_LENGTH).optional(),
    website: nullableTrimmed(COMPANY_WEBSITE_MAX_LENGTH).optional(),
    industry: nullableTrimmed(COMPANY_INDUSTRY_MAX_LENGTH).optional(),
    size: z.union([companySizeSchema, z.null()]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.name === undefined &&
      value.domain === undefined &&
      value.website === undefined &&
      value.industry === undefined &&
      value.size === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
    }
  });

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const softDeleteCompanySchema = z
  .object({
    companyId: z.string().uuid(),
  })
  .strict();

export type SoftDeleteCompanyInput = z.infer<typeof softDeleteCompanySchema>;

export const linkContactCompanySchema = z
  .object({
    contactId: z.string().uuid(),
    companyId: z.string().uuid(),
  })
  .strict();

export type LinkContactCompanyInput = z.infer<typeof linkContactCompanySchema>;

export const unlinkContactCompanySchema = z
  .object({
    contactId: z.string().uuid(),
  })
  .strict();

export type UnlinkContactCompanyInput = z.infer<typeof unlinkContactCompanySchema>;

export const createCustomFieldDefinitionSchema = z
  .object({
    key: z.string().trim().min(1).max(CUSTOM_FIELD_KEY_MAX_LENGTH).regex(CUSTOM_FIELD_KEY_PATTERN),
    label: z.string().trim().min(1).max(CUSTOM_FIELD_LABEL_MAX_LENGTH),
    field_type: customFieldTypeSchema,
    options: customFieldOptionsSchema.optional().default([]),
    sort_order: z
      .number()
      .int()
      .min(CUSTOM_FIELD_SORT_ORDER_MIN)
      .max(CUSTOM_FIELD_SORT_ORDER_MAX)
      .optional()
      .default(0),
    is_required: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.field_type === "select" && value.options.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "select fields require at least one option",
        path: ["options"],
      });
    }
    if (value.field_type !== "select" && value.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "options are only valid for select fields",
        path: ["options"],
      });
    }
  });

export type CreateCustomFieldDefinitionInput = z.infer<typeof createCustomFieldDefinitionSchema>;

export const updateCustomFieldDefinitionSchema = z
  .object({
    fieldId: z.string().uuid(),
    label: z.string().trim().min(1).max(CUSTOM_FIELD_LABEL_MAX_LENGTH).optional(),
    options: customFieldOptionsSchema.optional(),
    sort_order: z
      .number()
      .int()
      .min(CUSTOM_FIELD_SORT_ORDER_MIN)
      .max(CUSTOM_FIELD_SORT_ORDER_MAX)
      .optional(),
    is_required: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.label === undefined &&
      value.options === undefined &&
      value.sort_order === undefined &&
      value.is_required === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
    }
  });

export type UpdateCustomFieldDefinitionInput = z.infer<typeof updateCustomFieldDefinitionSchema>;

export const softDeleteCustomFieldDefinitionSchema = z
  .object({
    fieldId: z.string().uuid(),
  })
  .strict();

export type SoftDeleteCustomFieldDefinitionInput = z.infer<
  typeof softDeleteCustomFieldDefinitionSchema
>;

export const setContactCustomFieldValueSchema = z
  .object({
    contactId: z.string().uuid(),
    fieldId: z.string().uuid(),
    value: z.union([
      z.string().max(CUSTOM_FIELD_TEXT_VALUE_MAX_LENGTH),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  })
  .strict();

export type SetContactCustomFieldValueInput = z.infer<typeof setContactCustomFieldValueSchema>;

export const clearContactCustomFieldValueSchema = z
  .object({
    contactId: z.string().uuid(),
    fieldId: z.string().uuid(),
  })
  .strict();

export type ClearContactCustomFieldValueInput = z.infer<typeof clearContactCustomFieldValueSchema>;
