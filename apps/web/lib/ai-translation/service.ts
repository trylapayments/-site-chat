import { createHash } from "node:crypto";
import {
  buildTranslationRequest,
  translateText,
  TRANSLATION_PROMPT_VERSION,
  type AIProvider,
  type TranslationLanguage,
} from "@site-chat/ai";

export type TranslationInput = {
  workspaceId: string;
  conversationId: string;
  targetLanguage: TranslationLanguage;
  consent: boolean;
} & ({ mode: "message"; messageId: string } | { mode: "draft"; text: string; requestId: string });

export type TranslationReservation =
  | { status: "cached"; translatedText: string; remaining: number }
  | { status: "pending" }
  | { status: "failed" }
  | { status: "quota_exceeded"; remaining: number }
  | { status: "reserved"; id: string; remaining: number };

// Production adapters must perform fresh membership + billing authorization,
// resolve messages through conversation RLS, and atomically reserve quota/cache.
// No production route uses this service until those adapters are reviewed.
export type TranslationDependencies = {
  enabled: boolean;
  provider: AIProvider;
  authorize: (
    userId: string,
    input: TranslationInput,
  ) => Promise<{ enabled: boolean; ownerUserId: string; monthlyLimit: number }>;
  resolveSource: (userId: string, input: TranslationInput) => Promise<string>;
  reserve: (input: {
    ownerUserId: string;
    monthlyLimit: number;
    userId: string;
    workspaceId: string;
    conversationId: string;
    targetLanguage: TranslationLanguage;
    sourceHash: string;
    cacheKey: string;
    requestId: string;
    requestBinding: string;
  }) => Promise<TranslationReservation>;
  complete: (
    id: string,
    result: {
      translatedText: string;
      model: string;
      promptTokens: number | null;
      completionTokens: number | null;
    },
  ) => Promise<void>;
  // Retain failed reservations for reconciliation; never auto-reissue an
  // ambiguous provider request merely because the client retries.
  fail: (id: string) => Promise<void>;
};

function hash(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export class TranslationServiceError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function performTranslation(
  deps: TranslationDependencies,
  userId: string,
  input: TranslationInput,
) {
  if (!deps.enabled)
    throw new TranslationServiceError(
      "FEATURE_UNAVAILABLE",
      503,
      "AI translation is not available yet.",
    );
  if (!input.consent)
    throw new TranslationServiceError(
      "CONSENT_REQUIRED",
      400,
      "Confirm that this text may be sent to OpenAI.",
    );
  // Even cache hits require fresh access checks. Caller identity is server-derived.
  const access = await deps.authorize(userId, input);
  if (!access.enabled || !access.ownerUserId || ![1000, 5000, 15000].includes(access.monthlyLimit))
    throw new TranslationServiceError(
      "TRANSLATION_NOT_INCLUDED",
      403,
      "AI translation is not included in your subscription.",
    );
  const source = await deps.resolveSource(userId, input);
  buildTranslationRequest(source, input.targetLanguage);
  const sourceHash = hash([source]);
  const cacheKey = hash([
    access.ownerUserId,
    input.workspaceId,
    input.conversationId,
    sourceHash,
    input.targetLanguage,
    TRANSLATION_PROMPT_VERSION,
    deps.provider.id,
    deps.provider.metadata.model,
  ]);
  const reservation = await deps.reserve({
    ownerUserId: access.ownerUserId,
    monthlyLimit: access.monthlyLimit,
    userId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    targetLanguage: input.targetLanguage,
    sourceHash,
    cacheKey,
    requestId:
      input.mode === "draft"
        ? input.requestId
        : `message:${input.messageId}:${input.targetLanguage}`,
    requestBinding: hash([
      access.ownerUserId,
      userId,
      input.workspaceId,
      input.conversationId,
      input.mode === "draft" ? input.requestId : input.messageId,
      sourceHash,
      input.targetLanguage,
      TRANSLATION_PROMPT_VERSION,
    ]),
  });
  if (reservation.status === "pending")
    throw new TranslationServiceError(
      "TRANSLATION_PENDING",
      409,
      "This translation is still processing. Please try again shortly.",
    );
  if (reservation.status === "quota_exceeded")
    throw new TranslationServiceError(
      "TRANSLATION_QUOTA_EXCEEDED",
      429,
      "Your subscription’s monthly translation allowance has been used.",
    );
  if (reservation.status === "failed")
    throw new TranslationServiceError(
      "TRANSLATION_FAILED",
      503,
      "This translation could not be completed. The original message is unchanged.",
    );
  if (reservation.status === "cached") {
    if (!reservation.translatedText.trim())
      throw new TranslationServiceError(
        "INVALID_CACHED_TRANSLATION",
        503,
        "Translation is unavailable. Please try again later.",
      );
    return {
      source,
      translatedText: reservation.translatedText,
      targetLanguage: input.targetLanguage,
      cached: true,
      remaining: reservation.remaining,
    };
  }
  try {
    const result = await translateText(deps.provider, source, input.targetLanguage);
    await deps.complete(reservation.id, {
      translatedText: result.text,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    });
    return {
      source,
      translatedText: result.text,
      targetLanguage: input.targetLanguage,
      cached: false,
      remaining: reservation.remaining,
    };
  } catch (failure) {
    await deps.fail(reservation.id);
    throw failure;
  }
}
