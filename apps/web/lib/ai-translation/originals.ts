import type { authenticateMobile } from "@/lib/mobile/access";
import { z } from "zod";
import { translationServiceClient } from "./mobile";
import { TranslationServiceError } from "./service";

export type OperatorTranslationOriginal = {
  original: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
};

// Call only after bearer authentication and current workspace view authorization.
// Read messages through the operator's RLS client before touching private AI data.
export async function loadAuthorizedTranslationOriginals(
  client: Awaited<ReturnType<typeof authenticateMobile>>["client"],
  workspaceId: string,
  conversationId: string,
) {
  const { data: messages, error } = await client.from("messages")
    .select("id,client_message_id,body")
    .eq("workspace_id", workspaceId).eq("conversation_id", conversationId)
    .eq("sender_type", "agent").eq("is_internal", false)
    .order("sequence_number", { ascending: false }).limit(100)
    .overrideTypes<Array<{ id: string; client_message_id: string | null; body: string }>, { merge: false }>();
  if (error) throw new TranslationServiceError("FORBIDDEN", 403, "Unable to read conversation translations.");
  const originals: Record<string, OperatorTranslationOriginal> = {};
  const ids = messages.map(message => message.client_message_id).filter((id): id is string => Boolean(id));
  if (!ids.length) return { originals };
  const service = translationServiceClient();
  const { data: requests, error: requestError } = await service.from("ai_translation_requests")
    .select("request_id,job_id").eq("workspace_id", workspaceId).in("request_id", ids);
  if (requestError) throw new TranslationServiceError("TRANSLATION_UNAVAILABLE", 503, "Unable to load conversation translations.");
  const jobs = requests.map(request => request.job_id);
  if (!jobs.length) return { originals };
  const { data: rows, error: jobError } = await service.from("ai_translation_jobs")
    .select("id,translated_text,target_language").eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId).eq("state", "complete").in("id", jobs);
  if (jobError) throw new TranslationServiceError("TRANSLATION_UNAVAILABLE", 503, "Unable to load conversation translations.");
  const metadataSchema = z.object({ original: z.string(), text: z.string(), sourceLanguage: z.string() });
  for (const request of requests) {
    const row = rows.find(job => job.id === request.job_id);
    const message = messages.find(item => item.client_message_id === request.request_id);
    if (!row?.translated_text || !message) continue;
    let value: unknown;
    try { value = JSON.parse(row.translated_text); } catch { continue; }
    const metadata = metadataSchema.safeParse(value);
    if (!metadata.success) continue;
    const draft = metadata.data;
    if (message.body.trim() !== draft.text.trim() && message.body.trim() !== `${draft.original}\n\n${draft.text}`.trim()) continue;
    originals[message.id] = { original: draft.original, translated: draft.text, sourceLanguage: draft.sourceLanguage, targetLanguage: row.target_language };
  }
  return { originals };
}
