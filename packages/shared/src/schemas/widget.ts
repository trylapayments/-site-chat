import { z } from "zod";

export const widgetLocaleSchema = z.enum(["en", "ru"]);

export type WidgetLocale = z.infer<typeof widgetLocaleSchema>;

export const widgetPublicKeySchema = z
  .string()
  .regex(/^wk_[a-f0-9]{32}$/, "Invalid widget public key");

export const widgetBrandingSchema = z
  .object({
    displayName: z.string().nullable(),
    logoUrl: z.union([z.string().url(), z.null()]),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    showPoweredBy: z.boolean(),
  })
  .strict();

export type WidgetBranding = z.infer<typeof widgetBrandingSchema>;

export const widgetPublicConfigSchema = z
  .object({
    locale: widgetLocaleSchema,
    greetingMessage: z.string().min(1).max(500),
    reopenWindowHours: z.number().int().min(1).max(720),
    branding: widgetBrandingSchema,
    position: z.enum(["bottom-right", "bottom-left"]),
  })
  .strict();

export type WidgetPublicConfig = z.infer<typeof widgetPublicConfigSchema>;

export const widgetBootstrapDataSchema = z
  .object({
    widgetPublicKey: widgetPublicKeySchema,
    config: widgetPublicConfigSchema,
    embedToken: z.string().min(1),
    embedTokenExpiresAt: z.string(),
  })
  .strict();

export type WidgetBootstrapData = z.infer<typeof widgetBootstrapDataSchema>;

export const widgetSessionRequestSchema = z
  .object({
    embedToken: z.string().min(1),
    locale: widgetLocaleSchema.optional(),
    pageUrl: z.string().url().optional().nullable(),
    referrer: z.string().optional().nullable(),
  })
  .strict();

export type WidgetSessionRequest = z.infer<typeof widgetSessionRequestSchema>;

export const widgetConversationStatusSchema = z.enum(["open", "pending", "resolved", "closed"]);

export const widgetSessionDataSchema = z
  .object({
    sessionToken: z.string().min(1),
    expiresAt: z.string(),
    locale: widgetLocaleSchema,
    hasConversation: z.boolean(),
    conversationStatus: widgetConversationStatusSchema.nullable(),
  })
  .strict();

export type WidgetSessionData = z.infer<typeof widgetSessionDataSchema>;

export const widgetMessageItemSchema = z
  .object({
    id: z.string().uuid(),
    sequence_number: z.number().int(),
    sender_type: z.enum(["visitor", "agent", "system"]),
    body: z.string(),
    created_at: z.string(),
  })
  .strict();

export type WidgetMessageItem = z.infer<typeof widgetMessageItemSchema>;

export const widgetSendMessageRequestSchema = z
  .object({
    embedToken: z.string().min(1),
    body: z.string().trim().min(1).max(4000),
    clientMessageId: z.string().uuid().optional(),
    pageUrl: z.string().url().optional().nullable(),
    referrer: z.string().optional().nullable(),
  })
  .strict();

export type WidgetSendMessageRequest = z.infer<typeof widgetSendMessageRequestSchema>;

export const widgetSendMessageDataSchema = z
  .object({
    message: z
      .object({
        id: z.string().uuid(),
        sequence_number: z.number().int(),
        sender_type: z.enum(["visitor", "agent", "system"]),
        body: z.string(),
        created_at: z.string(),
      })
      .strict(),
    conversationStatus: widgetConversationStatusSchema,
  })
  .strict();

export type WidgetSendMessageData = z.infer<typeof widgetSendMessageDataSchema>;

export const widgetListMessagesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    beforeSequence: z.coerce.number().int().positive().optional(),
  })
  .strict();

export type WidgetListMessagesQuery = z.infer<typeof widgetListMessagesQuerySchema>;

export const widgetListMessagesDataSchema = z
  .object({
    items: z.array(widgetMessageItemSchema),
    has_older: z.boolean(),
    oldest_sequence: z.number().int().nullable(),
  })
  .strict();

export type WidgetListMessagesData = z.infer<typeof widgetListMessagesDataSchema>;

export const widgetApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "FORBIDDEN",
          "VALIDATION_ERROR",
          "SESSION_EXPIRED",
          "RATE_LIMITED",
          "EMBED_TOKEN_INVALID",
          "INTERNAL_ERROR",
        ]),
        message: z.string(),
        requestId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export const widgetApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z
    .object({
      data: dataSchema,
      meta: z.object({ requestId: z.string().uuid() }).strict(),
    })
    .strict();

export const widgetSettingsSchema = z
  .object({
    widget: z
      .object({
        locale: widgetLocaleSchema.optional(),
        greetingMessage: z.string().min(1).max(500).optional(),
        reopenWindowHours: z.number().int().min(1).max(720).optional(),
        position: z.enum(["bottom-right", "bottom-left"]).optional(),
        branding: z
          .object({
            displayName: z.string().min(1).max(100).optional(),
            logoUrl: z.string().url().optional(),
            primaryColor: z
              .string()
              .regex(/^#[0-9A-Fa-f]{6}$/)
              .optional(),
            showPoweredBy: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
