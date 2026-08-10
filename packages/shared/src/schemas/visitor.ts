import { z } from "zod";

import {
  DEVICE_TYPES,
  VISITOR_LANGUAGE_MAX_LENGTH,
  VISITOR_PUBLIC_ID_PATTERN,
  VISITOR_RECENT_PAGE_VIEWS_LIMIT,
  VISITOR_REFERRER_MAX_LENGTH,
  VISITOR_TIMEZONE_MAX_LENGTH,
  VISITOR_TITLE_MAX_LENGTH,
  VISITOR_URL_MAX_LENGTH,
  VISITOR_UTM_MAX_LENGTH,
} from "../visitor/constants";
import {
  normalizeVisitorAttributes,
  normalizeVisitorEmail,
  normalizeVisitorName,
  normalizeVisitorPhone,
  VisitorIdentityError,
} from "../visitor/identity";
import { sanitizePageTitle, sanitizePageUrl, sanitizeReferrer } from "../visitor/page-context";

export const visitorPublicIdSchema = z
  .string()
  .regex(VISITOR_PUBLIC_ID_PATTERN, "Invalid visitor public id");

export const deviceTypeSchema = z.enum(DEVICE_TYPES);

const optionalBoundedUrl = z
  .union([z.string().max(VISITOR_URL_MAX_LENGTH), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const sanitized = sanitizePageUrl(value);
    if (value.trim().length > 0 && sanitized === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid URL" });
      return z.NEVER;
    }
    return sanitized;
  });

const optionalTitle = z
  .union([z.string().max(VISITOR_TITLE_MAX_LENGTH), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return sanitizePageTitle(value);
  });

const optionalReferrer = z
  .union([z.string().max(VISITOR_REFERRER_MAX_LENGTH), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return sanitizeReferrer(value);
  });

const optionalTimezone = z
  .union([z.string().max(VISITOR_TIMEZONE_MAX_LENGTH), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, VISITOR_TIMEZONE_MAX_LENGTH);
  });

const optionalLanguage = z
  .union([z.string().max(VISITOR_LANGUAGE_MAX_LENGTH), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, VISITOR_LANGUAGE_MAX_LENGTH);
  });

export const visitorAttributeValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const visitorAttributesSchema = z
  .record(z.string(), visitorAttributeValueSchema)
  .superRefine((value, ctx) => {
    try {
      normalizeVisitorAttributes(value);
    } catch (error) {
      if (error instanceof VisitorIdentityError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });

export const visitorIdentifyRequestSchema = z
  .object({
    embedToken: z.string().min(1),
    name: z.union([z.string().max(120), z.null()]).optional(),
    email: z.union([z.string().max(254), z.null()]).optional(),
    phone: z.union([z.string().max(64), z.null()]).optional(),
    attributes: visitorAttributesSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      if (value.name !== undefined) normalizeVisitorName(value.name);
      if (value.email !== undefined) normalizeVisitorEmail(value.email);
      if (value.phone !== undefined) normalizeVisitorPhone(value.phone);
    } catch (error) {
      if (error instanceof VisitorIdentityError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });

export type VisitorIdentifyRequest = z.infer<typeof visitorIdentifyRequestSchema>;

export const visitorIdentifyDataSchema = z
  .object({
    visitorPublicId: visitorPublicIdSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    attributes: z.record(z.string(), visitorAttributeValueSchema),
  })
  .strict();

export type VisitorIdentifyData = z.infer<typeof visitorIdentifyDataSchema>;

export const visitorPageViewRequestSchema = z
  .object({
    embedToken: z.string().min(1),
    url: z.string().min(1).max(VISITOR_URL_MAX_LENGTH),
    title: z.union([z.string().max(VISITOR_TITLE_MAX_LENGTH), z.null()]).optional(),
    referrer: z.union([z.string().max(VISITOR_REFERRER_MAX_LENGTH), z.null()]).optional(),
    timezone: optionalTimezone,
    language: optionalLanguage,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!sanitizePageUrl(value.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid page URL",
        path: ["url"],
      });
    }
  });

export type VisitorPageViewRequest = z.infer<typeof visitorPageViewRequestSchema>;

export const visitorPageViewDataSchema = z
  .object({
    recorded: z.boolean(),
    deduped: z.boolean(),
    currentUrl: z.string().nullable(),
    currentTitle: z.string().nullable(),
  })
  .strict();

export type VisitorPageViewData = z.infer<typeof visitorPageViewDataSchema>;

export const visitorPageViewItemSchema = z
  .object({
    id: z.string().uuid(),
    url: z.string(),
    title: z.string().nullable(),
    referrer: z.string().nullable(),
    utm_source: z.string().nullable(),
    utm_medium: z.string().nullable(),
    utm_campaign: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

export type VisitorPageViewItem = z.infer<typeof visitorPageViewItemSchema>;

export const visitorContextSchema = z
  .object({
    current_url: z.string().nullable(),
    current_title: z.string().nullable(),
    landing_url: z.string().nullable(),
    referrer: z.string().nullable(),
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    utm_content: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
    browser_family: z.string().nullable(),
    browser_version: z.string().nullable(),
    os_family: z.string().nullable(),
    device_type: deviceTypeSchema.nullable(),
    locale: z.string().nullable(),
    timezone: z.string().nullable(),
    language: z.string().nullable().optional(),
    country_code: z.string().nullable().optional(),
  })
  .strict();

export type VisitorContext = z.infer<typeof visitorContextSchema>;

export const visitorProfileSchema = z
  .object({
    public_id: visitorPublicIdSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    attributes: z.record(z.string(), visitorAttributeValueSchema).default({}),
    first_seen_at: z.string(),
    last_seen_at: z.string(),
    visit_count: z.number().int().positive(),
  })
  .strict();

export type VisitorProfile = z.infer<typeof visitorProfileSchema>;

export const visitorActivitySchema = z
  .object({
    first_seen_at: z.string(),
    last_seen_at: z.string(),
    visit_count: z.number().int().positive(),
    recent_page_views: z.array(visitorPageViewItemSchema).max(VISITOR_RECENT_PAGE_VIEWS_LIMIT),
  })
  .strict();

export type VisitorActivity = z.infer<typeof visitorActivitySchema>;

export const operatorUpdateVisitorSchema = z
  .object({
    conversationId: z.string().uuid(),
    name: z.union([z.string().max(120), z.null()]).optional(),
    email: z.union([z.string().max(254), z.null()]).optional(),
    phone: z.union([z.string().max(64), z.null()]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.name === undefined && value.email === undefined && value.phone === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
      return;
    }
    try {
      if (value.name !== undefined) normalizeVisitorName(value.name);
      if (value.email !== undefined) normalizeVisitorEmail(value.email);
      if (value.phone !== undefined) normalizeVisitorPhone(value.phone);
    } catch (error) {
      if (error instanceof VisitorIdentityError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });

export type OperatorUpdateVisitorInput = z.infer<typeof operatorUpdateVisitorSchema>;

export const hostIdentifyPayloadSchema = z
  .object({
    name: z.union([z.string().max(120), z.null()]).optional(),
    email: z.union([z.string().max(254), z.null()]).optional(),
    phone: z.union([z.string().max(64), z.null()]).optional(),
    attributes: visitorAttributesSchema.optional(),
  })
  .strict();

export type HostIdentifyPayload = z.infer<typeof hostIdentifyPayloadSchema>;

export const utmFieldsSchema = z
  .object({
    utm_source: z.string().max(VISITOR_UTM_MAX_LENGTH).nullable().optional(),
    utm_medium: z.string().max(VISITOR_UTM_MAX_LENGTH).nullable().optional(),
    utm_campaign: z.string().max(VISITOR_UTM_MAX_LENGTH).nullable().optional(),
    utm_content: z.string().max(VISITOR_UTM_MAX_LENGTH).nullable().optional(),
    utm_term: z.string().max(VISITOR_UTM_MAX_LENGTH).nullable().optional(),
  })
  .strict();

export { optionalBoundedUrl, optionalTitle, optionalReferrer, optionalTimezone, optionalLanguage };
