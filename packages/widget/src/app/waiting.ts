/** The acknowledgement survives reloads and ends with the first operator reply. */
export function shouldShowWaitingAcknowledgement(
  messages: readonly {
    senderType: string;
    isOptimistic?: boolean;
    status?: string;
  }[],
): boolean {
  return (
    messages.some(
      (message) =>
        message.senderType === "visitor" && !message.isOptimistic && message.status !== "failed",
    ) && !messages.some((message) => message.senderType === "agent")
  );
}
