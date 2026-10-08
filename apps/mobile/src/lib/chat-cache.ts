import type { ConversationDetail, ListMessagesResult } from "@site-chat/shared";
import { api } from "./client";
import { cacheKey, remember } from "./cache";
const pending = new Map<
  string,
  Promise<{ conversation: ConversationDetail; messages: ListMessagesResult }>
>();
export function fetchChatBootstrap(userId: string, workspaceId: string, id: string) {
  const key = cacheKey(userId, workspaceId, `chat:${id}`);
  const current = pending.get(key);
  if (current) return current;
  const promise = api<{ conversation: ConversationDetail; messages: ListMessagesResult }>(
    "chatBootstrap",
    workspaceId,
    { conversationId: id, limit: 30 },
    userId,
  ).then((result) => {
    remember(key, { detail: result.conversation, messages: result.messages.items });
    return result;
  });
  pending.set(key, promise);
  void promise.finally(() => pending.delete(key)).catch(() => {});
  return promise;
}
