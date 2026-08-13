import { describe, expect, it } from "vitest";

import {
  applyInternalNoteRealtimeChange,
  extractMentionTokens,
  filterMentionableMembers,
  mergeInternalNotes,
  mergeMentionMemberIds,
  resolveMentionMemberIds,
  splitNoteBodyWithMentions,
} from "./state.js";
import { parseNoteErrorMessage } from "./errors.js";
import type { InternalNote } from "../schemas/internal-notes.js";
import type { WorkspaceMemberOption } from "../schemas/conversation.js";

const owner: WorkspaceMemberOption = {
  member_id: "11111111-1111-4111-8111-111111111111",
  display_label: "owner@local.test",
  role: "owner",
};
const agent: WorkspaceMemberOption = {
  member_id: "22222222-2222-4222-8222-222222222222",
  display_label: "agent@local.test",
  role: "agent",
};
const viewer: WorkspaceMemberOption = {
  member_id: "33333333-3333-4333-8333-333333333333",
  display_label: "viewer@local.test",
  role: "viewer",
};
const members: WorkspaceMemberOption[] = [owner, agent, viewer];

function note(partial: Partial<InternalNote> & Pick<InternalNote, "id">): InternalNote {
  return {
    workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    author_member_id: owner.member_id,
    author_display_label: owner.display_label,
    body: "hello",
    created_at: "2026-08-13T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z",
    deleted_at: null,
    mentions: [],
    ...partial,
  };
}

describe("mention parsing", () => {
  it("extracts @tokens including emails", () => {
    const tokens = extractMentionTokens("Hey @agent and @owner@local.test please review");
    expect(tokens.map((t) => t.token)).toEqual(["agent", "owner@local.test"]);
  });

  it("resolves unique member matches and ignores viewers", () => {
    const ids = resolveMentionMemberIds("ping @agent and @viewer", members);
    expect(ids).toEqual([agent.member_id]);
  });

  it("merges explicit ids with body resolution without duplicates", () => {
    const ids = mergeMentionMemberIds([owner.member_id, owner.member_id], "also @agent", members);
    expect(ids).toEqual([owner.member_id, agent.member_id]);
  });

  it("filters mentionable members for autocomplete", () => {
    const filtered = filterMentionableMembers(members, "agent");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.member_id).toBe(agent.member_id);
  });
});

describe("mergeInternalNotes", () => {
  it("merges by id, prefers newer updated_at, drops soft-deleted", () => {
    const current = [
      note({ id: "n1", body: "old", updated_at: "2026-08-13T12:00:00.000Z" }),
      note({ id: "n2", body: "keep", created_at: "2026-08-13T11:00:00.000Z" }),
    ];
    const incoming = [
      note({ id: "n1", body: "new", updated_at: "2026-08-13T13:00:00.000Z" }),
      note({ id: "n3", body: "added", created_at: "2026-08-13T14:00:00.000Z" }),
      note({
        id: "n2",
        body: "deleted",
        deleted_at: "2026-08-13T14:00:00.000Z",
        updated_at: "2026-08-13T14:00:00.000Z",
      }),
    ];

    const merged = mergeInternalNotes(current, incoming);
    expect(merged.map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(merged[0]?.body).toBe("new");
  });

  it("applyInternalNoteRealtimeChange removes soft-deleted notes", () => {
    const current = [note({ id: "n1" })];
    const next = applyInternalNoteRealtimeChange(
      current,
      note({
        id: "n1",
        deleted_at: "2026-08-13T15:00:00.000Z",
        updated_at: "2026-08-13T15:00:00.000Z",
      }),
    );
    expect(next).toEqual([]);
  });
});

describe("splitNoteBodyWithMentions", () => {
  it("highlights resolved mentions", () => {
    const segments = splitNoteBodyWithMentions("Hi @agent please look", [
      { member_id: agent.member_id, display_label: agent.display_label },
    ]);
    expect(segments).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", text: "@agent", memberId: agent.member_id },
      { type: "text", text: " please look" },
    ]);
  });
});

describe("parseNoteErrorMessage", () => {
  it("maps typed prefixes", () => {
    const err = parseNoteErrorMessage("FORBIDDEN: Viewers cannot access internal notes.");
    expect(err?.code).toBe("FORBIDDEN");
  });
});
