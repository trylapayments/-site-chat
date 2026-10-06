export type PendingMessage = {
  id: string;
  userId: string;
  workspaceId: string;
  conversationId: string;
  body: string;
  createdAt: string;
  attempts: number;
  nextAttempt: number;
  state: "queued" | "failed";
  error?: string;
  file?: { uri: string; filename: string; mimeType: string; sizeBytes: number };
  upload?: {
    batchId: string;
    uploads: {
      uploadId: string;
      uploadUrl: string;
      headers?: Record<string, string>;
      expiresAt?: string;
    }[];
  };
};
export function eligible(items: PendingMessage[], userId: string, now: number) {
  return items.filter((m) => m.userId === userId && m.state === "queued" && m.nextAttempt <= now);
}
export function failedAttempt(item: PendingMessage, status: number, now: number): PendingMessage {
  const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  const attempts = item.attempts + 1;
  return {
    ...item,
    attempts,
    state: permanent || attempts >= 8 ? "failed" : "queued",
    nextAttempt: now + Math.min(60000, 1000 * 2 ** attempts),
  };
}
export function mergeMessages<
  T extends { id: string; sequence_number: number; client_message_id?: string | null },
>(previous: T[], incoming: T[]) {
  const rows = new Map(previous.map((m) => [m.id, m]));
  for (const row of incoming) rows.set(row.id, row);
  const clientIds = new Set<string>();
  return [...rows.values()]
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .filter((row) => {
      if (!row.client_message_id) return true;
      if (clientIds.has(row.client_message_id)) return false;
      clientIds.add(row.client_message_id);
      return true;
    });
}
export function pushDestination(
  data: unknown,
): { workspaceId: string; conversationId: string } | null {
  if (!data || typeof data !== "object") return null;
  const { workspaceId, conversationId } = data as Record<string, unknown>;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  return typeof workspaceId === "string" &&
    typeof conversationId === "string" &&
    uuid.test(workspaceId) &&
    uuid.test(conversationId)
    ? { workspaceId, conversationId }
    : null;
}
