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

/** Use durable timestamps, so reopening/reloading never restarts the wait. */
export function unansweredSince(
  messages: readonly {
    senderType: string;
    body?: string;
    createdAt: string;
    sequenceNumber: number;
    isOptimistic?: boolean;
    isInternal?: boolean;
    status?: string;
  }[],
): number | null {
  // This offer is only for the initial wait; a public operator reply ends it permanently.
  if (messages.some((m) => m.senderType === "agent" && !m.isInternal)) return null;
  const accepted = messages.filter((m) => !m.isOptimistic && m.status !== "failed");
  const visitors = accepted.filter((m) => m.senderType === "visitor");
  const times = visitors.map((m) => Date.parse(m.createdAt)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}
