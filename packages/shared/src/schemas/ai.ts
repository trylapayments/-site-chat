import { z } from "zod";

/**
 * Canonical AI provider ids used by API contracts and workspace config.
 * Keep in sync with packages/ai AI_PROVIDER_IDS (tested).
 */
export const AI_PROVIDER_IDS = ["openai", "mock", "anthropic", "gemini", "ollama"] as const;

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_ERROR_CODES = [
  "AI_DISABLED",
  "AI_NOT_CONFIGURED",
  "AI_RATE_LIMITED",
  "AI_PROVIDER_ERROR",
  "AI_TIMEOUT",
  "AI_CANCELLED",
  "AI_INVALID_RESPONSE",
  "AI_UNAVAILABLE",
] as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

const AI_SSE_DELTA_MAX_CHARS = 2_000;
const AI_SSE_MESSAGE_MAX_CHARS = 500;
const AI_SSE_SUGGESTION_MAX_CHARS = 4_000;

export const suggestedReplyRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    /**
     * When true, the server generates an opaque regenerateSeed for provider
     * entropy. Never send client-controlled nonce text into prompts.
     */
    regenerate: z.boolean().optional(),
  })
  .strict();

export type SuggestedReplyRequest = z.infer<typeof suggestedReplyRequestSchema>;

export const suggestedReplyStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("delta"),
      text: z.string().max(AI_SSE_DELTA_MAX_CHARS),
    })
    .strict(),
  z
    .object({
      type: z.literal("done"),
      suggestion: z.string().min(1).max(AI_SSE_SUGGESTION_MAX_CHARS),
      model: z.string().max(128),
      provider: z.enum(AI_PROVIDER_IDS),
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
      code: z.enum(AI_ERROR_CODES),
      message: z.string().max(AI_SSE_MESSAGE_MAX_CHARS),
    })
    .strict(),
  z
    .object({
      type: z.literal("cancelled"),
    })
    .strict(),
]);

export type SuggestedReplyStreamEvent = z.infer<typeof suggestedReplyStreamEventSchema>;

export const aiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(AI_ERROR_CODES),
        message: z.string().max(AI_SSE_MESSAGE_MAX_CHARS),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const AI_SSE_BOUNDS = {
  deltaMaxChars: AI_SSE_DELTA_MAX_CHARS,
  messageMaxChars: AI_SSE_MESSAGE_MAX_CHARS,
  suggestionMaxChars: AI_SSE_SUGGESTION_MAX_CHARS,
} as const;
