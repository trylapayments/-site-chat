import { test } from "node:test";
import assert from "node:assert/strict";
import type { InternalNote } from "@site-chat/shared";
import { mergeNotes, noteEditInput } from "./notes.ts";
const note = (id: string, extra: Partial<InternalNote> = {}): InternalNote => ({
  id,
  workspace_id: "workspace",
  conversation_id: "conversation",
  author_member_id: "member",
  author_display_label: "Alex",
  body: "Original",
  created_at: "2026-10-07T10:00:00Z",
  updated_at: "2026-10-07T10:00:00Z",
  mentions: [{ member_id: "other", display_label: "Sam" }],
  ...extra,
});
test("note edit preserves existing operator mentions", () => {
  assert.deepEqual(noteEditInput(note("a"), " Changed "), {
    noteId: "a",
    body: "Changed",
    mentionedMemberIds: ["other"],
  });
});
test("retry response updates one note without duplication", () => {
  const saved = note("a", {
    body: "Changed",
    updated_at: "2026-10-07T11:00:00Z",
  });
  assert.deepEqual(mergeNotes([note("a")], [saved, saved]), [saved]);
});
test("soft deletion removes only the target note", () => {
  assert.deepEqual(
    mergeNotes(
      [note("a"), note("b")],
      [
        note("a", {
          deleted_at: "2026-10-07T12:00:00Z",
          updated_at: "2026-10-07T12:00:00Z",
        }),
      ],
    ),
    [note("b")],
  );
});
test("old page response cannot overwrite a newly edited note", () => {
  const saved = note("a", {
    body: "Changed",
    updated_at: "2026-10-07T11:00:00Z",
  });
  assert.deepEqual(mergeNotes([saved], [note("a")]), [saved]);
});
