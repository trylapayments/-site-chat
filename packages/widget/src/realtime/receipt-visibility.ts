import type { MessageView } from "@site-chat/shared";

/**
 * Visitor read receipts require the chat panel to be open and the document
 * visible. Connection alone must never imply "seen".
 */
export function shouldMarkMessagesRead(input: {
  panelOpen: boolean;
  visibilityState: DocumentVisibilityState;
}): boolean {
  return input.panelOpen && input.visibilityState === "visible";
}

/** Highest sequence among agent messages currently in the open panel. */
export function maxAgentMessageSequence(messages: ReadonlyArray<MessageView>): number {
  let max = 0;
  for (const message of messages) {
    if (message.senderType === "agent" && message.sequenceNumber > max) {
      max = message.sequenceNumber;
    }
  }
  return max;
}
