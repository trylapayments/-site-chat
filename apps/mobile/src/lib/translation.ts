import { api } from "./client";
import type {
  TranslationLanguage,
  TranslationPreview,
} from "../core/translation";

export type TranslationCapabilities = {
  enabled: boolean;
  remaining: number;
  monthlyLimit: number;
};

export function translationCapabilities(userId: string, workspaceId: string) {
  return api<TranslationCapabilities>(
    "translationCapabilities",
    workspaceId,
    {},
    userId,
  );
}

export function previewReplyTranslation(
  userId: string,
  workspaceId: string,
  conversationId: string,
  text: string,
  targetLanguage: TranslationLanguage,
  requestId: string,
) {
  return api<TranslationPreview>(
    "previewReplyTranslation",
    workspaceId,
    { conversationId, text, targetLanguage, consent: true, requestId },
    userId,
  );
}

export function translateMessage(
  userId: string,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  targetLanguage: TranslationLanguage,
) {
  return api<TranslationPreview>(
    "translateMessage",
    workspaceId,
    { conversationId, messageId, targetLanguage, consent: true },
    userId,
  );
}
