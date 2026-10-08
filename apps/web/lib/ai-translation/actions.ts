"use server";

import { z } from "zod";
import { AIError, toPublicAIError } from "@site-chat/ai";
import { createClient } from "@/lib/supabase/server";
import { MobileError, authorizeMobile } from "@/lib/mobile/access";
import { mobileTranslate, translationServiceClient } from "./mobile";
import { TranslationServiceError } from "./service";

export async function translateInPortal(raw: unknown) {
  try {
    const { workspaceId, operation, input } = z.object({
      workspaceId: z.string().uuid(),
      operation: z.enum(["translateMessage", "previewReplyTranslation"]),
      input: z.unknown(),
    }).strict().parse(raw);
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Fail closed on malformed authentication responses.
    if (error || !data.user || !data.user.email_confirmed_at)
      return { ok: false as const, error: "Please sign in again." };
    const result = await mobileTranslate({ client, user: data.user }, workspaceId, operation, { ...z.record(z.unknown()).parse(input), withSourceLanguage: true });
    return { ok: true as const, result };
  } catch (error) {
    if (error instanceof TranslationServiceError || error instanceof MobileError)
      return { ok: false as const, error: error.message };
    if (error instanceof AIError)
      return { ok: false as const, error: toPublicAIError(error).message };
    return { ok: false as const, error: "Unable to translate. Please try again." };
  }
}


/** Original operator drafts stay in the operator-only translation cache, never widget data. */
export async function loadOperatorReplyOriginals(raw: unknown) {
  try {
    const { workspaceId, conversationId } = z.object({ workspaceId: z.string().uuid(), conversationId: z.string().uuid() }).strict().parse(raw);
    const client = await createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Guard malformed auth responses.
    if (authError || !auth.user || !auth.user.email_confirmed_at) return { ok: false as const };
    await authorizeMobile({ client, user: auth.user }, workspaceId);
    const { data: messages, error } = await client.from("messages").select("client_message_id,body").eq("workspace_id", workspaceId).eq("conversation_id", conversationId).eq("sender_type", "agent").eq("is_internal", false).order("sequence_number", { ascending: false }).limit(100).overrideTypes<Array<{ client_message_id: string | null; body: string }>, { merge: false }>();
    if (error) return { ok: false as const };
    const ids = messages.map(message => message.client_message_id).filter((id): id is string => Boolean(id));
    if (!ids.length) return { ok: true as const, originals: {} };
    const service = translationServiceClient();
    const { data: requests, error: requestError } = await service.from("ai_translation_requests").select("request_id,job_id").eq("workspace_id", workspaceId).in("request_id", ids);
    if (requestError) return { ok: false as const };
    const jobs = requests.map(request => request.job_id);
    if (!jobs.length) return { ok: true as const, originals: {} };
    const { data: rows, error: jobError } = await service.from("ai_translation_jobs").select("id,translated_text,target_language").eq("workspace_id", workspaceId).eq("conversation_id", conversationId).eq("state", "complete").in("id", jobs);
    if (jobError) return { ok: false as const };
    const originals: Record<string, { original: string; translated: string; sourceLanguage: string; targetLanguage: string }> = {};
    for (const request of requests) {
      const row = rows.find(job => job.id === request.job_id);
      const message = messages.find(item => item.client_message_id === request.request_id);
      if (!row?.translated_text || !message) continue;
      let rawMetadata: unknown; try { rawMetadata = JSON.parse(row.translated_text); } catch { continue; }
      const metadata = z.object({ original: z.string(), text: z.string(), sourceLanguage: z.string() }).safeParse(rawMetadata);
      if (!metadata.success) continue;
      const value = metadata.data;
      if (message.body.trim() !== value.text.trim() && message.body.trim() !== `${value.original}\n\n${value.text}`.trim()) continue;
      originals[request.request_id] = { original: value.original, translated: value.text, sourceLanguage: value.sourceLanguage, targetLanguage: row.target_language };
    }
    return { ok: true as const, originals };
  } catch { return { ok: false as const }; }
}
