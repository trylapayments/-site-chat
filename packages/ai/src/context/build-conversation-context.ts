import { sanitizePlainText } from "../safety/sanitize";
import {
  DEFAULT_CONTEXT_MESSAGE_BODY_MAX,
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  type ConversationContext,
  type ConversationContextInput,
  type ContextMessage,
} from "./types";

export type BuildConversationContextOptions = {
  messageLimit?: number;
  bodyMaxLength?: number;
};

/**
 * Build a bounded, deterministically ordered conversation context.
 * Does not include secrets, API keys, or unrelated tenant records.
 */
export function buildConversationContext(
  input: ConversationContextInput,
  options: BuildConversationContextOptions = {},
): ConversationContext {
  const messageLimit = options.messageLimit ?? DEFAULT_CONTEXT_MESSAGE_LIMIT;
  const bodyMaxLength = options.bodyMaxLength ?? DEFAULT_CONTEXT_MESSAGE_BODY_MAX;

  const ordered = [...input.messages].sort((a, b) => {
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    const byTime = a.createdAt.localeCompare(b.createdAt);
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });

  const recent =
    ordered.length > messageLimit ? ordered.slice(ordered.length - messageLimit) : ordered;

  const messages: ContextMessage[] = recent
    .map((message) => ({
      id: message.id,
      sequenceNumber: message.sequenceNumber,
      senderType: message.senderType,
      body: sanitizePlainText(message.body, bodyMaxLength),
      createdAt: message.createdAt,
    }))
    .filter((message) => message.body.length > 0);

  return {
    workspace: {
      id: input.workspace.id,
      name: sanitizePlainText(input.workspace.name, 120),
    },
    operator: input.operator
      ? {
          id: input.operator.id,
          displayName: input.operator.displayName
            ? sanitizePlainText(input.operator.displayName, 120)
            : null,
        }
      : null,
    visitor: input.visitor
      ? {
          displayName: input.visitor.displayName
            ? sanitizePlainText(input.visitor.displayName, 120)
            : null,
        }
      : null,
    messages,
  };
}
