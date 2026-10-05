export type TranscriptMessage = {
  sender_type: string;
  body: string;
  is_internal: boolean;
  created_at: string;
  metadata_json: unknown;
  agent_member_id: string | null;
};
export function formatTranscript(
  workspaceName: string,
  messages: TranscriptMessage[],
  names: Map<string, string> = new Map(),
) {
  const lines = [`${workspaceName} — conversation transcript`, ""];
  for (const m of messages) {
    if (m.is_internal) continue;
    const label =
      m.sender_type === "visitor"
        ? "Visitor"
        : m.sender_type === "agent"
          ? (names.get(m.agent_member_id ?? "") ?? "Agent")
          : "System";
    lines.push(`[${new Date(m.created_at).toISOString()}] ${label}`, m.body);
    // Attachment names only: do not expose private storage keys or signed URLs.
    const metadata = m.metadata_json as {
      attachments?: { filename?: string; original_filename?: string }[];
    } | null;
    for (const a of metadata?.attachments ?? [])
      lines.push(`Attachment: ${a.filename ?? a.original_filename ?? "File"}`);
    lines.push("");
  }
  return lines.join("\n");
}
