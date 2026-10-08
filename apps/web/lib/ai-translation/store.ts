import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TranslationDependencies } from "./service";
import { TranslationServiceError } from "./service";

const reservation = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("cached"),
    translatedText: z.string().trim().min(1),
    remaining: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal("reserved"),
    id: z.string().uuid(),
    remaining: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal("quota_exceeded"), remaining: z.number().int().nonnegative() }),
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("failed") }),
]);
/** Isolated untyped client until reviewed migration types are generated. All
 * dynamic responses are validated; this adapter must receive a server client. */
export function translationStore(
  service: SupabaseClient,
): Pick<TranslationDependencies, "reserve" | "complete" | "fail"> {
  return {
    async reserve(input) {
      const { data, error } = await service.rpc("reserve_ai_translation", {
        p_owner_user_id: input.ownerUserId,
        p_user_id: input.userId,
        p_workspace_id: input.workspaceId,
        p_conversation_id: input.conversationId,
        p_target_language: input.targetLanguage,
        p_source_hash: input.sourceHash,
        p_cache_key: input.cacheKey,
        p_request_id: input.requestId,
        p_binding: input.requestBinding,
        p_limit: input.monthlyLimit,
      });
      if (error) {
        if (error.code === "22023")
          throw new TranslationServiceError(
            "REQUEST_CHANGED",
            409,
            "This translation request no longer matches the original text.",
          );
        if (error.code === "42501")
          throw new TranslationServiceError("FORBIDDEN", 403, "Translation access denied.");
        throw new TranslationServiceError(
          "TRANSLATION_UNAVAILABLE",
          503,
          "Translation is temporarily unavailable.",
        );
      }
      return reservation.parse(data);
    },
    async complete(id, result) {
      const { data, error } = await service
        .from("ai_translation_jobs")
        .update({
          state: "complete",
          translated_text: result.translatedText,
          model: result.model,
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("state", "pending")
        .select("id")
        .maybeSingle();
      if (error || !data)
        throw new TranslationServiceError(
          "TRANSLATION_UNAVAILABLE",
          503,
          "Unable to save the translation.",
        );
    },
    async fail(id) {
      // A lost successful completion response must never overwrite a completed job.
      const { error } = await service
        .from("ai_translation_jobs")
        .update({ state: "failed" })
        .eq("id", id)
        .eq("state", "pending");
      if (error)
        throw new TranslationServiceError(
          "TRANSLATION_UNAVAILABLE",
          503,
          "Translation is temporarily unavailable.",
        );
    },
  };
}
