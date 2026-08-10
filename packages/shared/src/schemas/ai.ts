import { z } from "zod";

export const suggestedReplyRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    /**
     * Opaque regenerate nonce so mock/provider drafts can differ across retries
     * without sending extra tenant data.
     */
    regenerateNonce: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type SuggestedReplyRequest = z.infer<typeof suggestedReplyRequestSchema>;

export const suggestedReplyStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("delta"),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("done"),
      suggestion: z.string().min(1).max(4000),
      model: z.string(),
      provider: z.enum(["openai", "mock", "anthropic", "gemini", "ollama"]),
      usage: z
        .object({
          promptTokens: z.number().int().nonnegative().nullable(),
          completionTokens: z.number().int().nonnegative().nullable(),
          totalTokens: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.enum([
        "AI_DISABLED",
        "AI_NOT_CONFIGURED",
        "AI_RATE_LIMITED",
        "AI_PROVIDER_ERROR",
        "AI_TIMEOUT",
        "AI_INVALID_RESPONSE",
        "AI_UNAVAILABLE",
      ]),
      message: z.string(),
    })
    .strict(),
]);

export type SuggestedReplyStreamEvent = z.infer<typeof suggestedReplyStreamEventSchema>;

export const aiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "AI_DISABLED",
          "AI_NOT_CONFIGURED",
          "AI_RATE_LIMITED",
          "AI_PROVIDER_ERROR",
          "AI_TIMEOUT",
          "AI_INVALID_RESPONSE",
          "AI_UNAVAILABLE",
        ]),
        message: z.string(),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();
