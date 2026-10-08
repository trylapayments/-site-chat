import type { InternalNote } from "@site-chat/shared";

/** Apply server rows and soft-delete tombstones without duplicating retries. */
export function mergeNotes(current: InternalNote[], changes: InternalNote[]): InternalNote[] {
  const rows = new Map(current.map((note) => [note.id, note]));
  for (const note of changes) {
    const existing = rows.get(note.id);
    if (existing && existing.updated_at > note.updated_at) continue;
    if (note.deleted_at) rows.delete(note.id);
    else rows.set(note.id, note);
  }
  return [...rows.values()].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}

export function noteEditInput(note: InternalNote, body: string) {
  return {
    noteId: note.id,
    body: body.trim(),
    mentionedMemberIds: note.mentions.map((mention) => mention.member_id),
  };
}
