import {
  maxSequenceNumber,
  type MessageView,
} from "@site-chat/shared";

/**
 * Structural equality for thread message lists.
 * Used to avoid setState when server props rematerialize with identical content.
 */
export function areMessageViewsEquivalent(
  left: MessageView[],
  right: MessageView[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }

    if (
      a.id !== b.id ||
      a.sequenceNumber !== b.sequenceNumber ||
      a.senderType !== b.senderType ||
      a.senderLabel !== b.senderLabel ||
      a.body !== b.body ||
      a.createdAt !== b.createdAt ||
      a.clientMessageId !== b.clientMessageId ||
      a.isInternal !== b.isInternal ||
      a.status !== b.status ||
      a.isOptimistic !== b.isOptimistic
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Reconcile live thread state when conversationId / initialMessages props change.
 * Returns `current` when the next state would be equivalent (stable reference).
 */
export function reconcileThreadMessages(input: {
  conversationChanged: boolean;
  current: MessageView[];
  initialMessages: MessageView[];
}): MessageView[] {
  if (input.conversationChanged) {
    return input.initialMessages;
  }

  if (
    input.current.some(
      (message) => message.isOptimistic || message.status === "pending",
    )
  ) {
    return input.current;
  }

  const serverMax = maxSequenceNumber(input.initialMessages);
  const localMax = maxSequenceNumber(input.current);

  if (localMax > serverMax) {
    return input.current;
  }

  if (areMessageViewsEquivalent(input.current, input.initialMessages)) {
    return input.current;
  }

  return input.initialMessages;
}
