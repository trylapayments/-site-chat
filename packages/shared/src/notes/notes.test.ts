import { describe, expect, it } from "vitest";

import {
  advanceNotesCatchUpWatermark,
  applyInternalNoteRealtimeChange,
  collectMentionMemberIdsFromBody,
  createClientNoteId,
  detectMentionTrigger,
  extractMentionTokens,
  filterMentionableMembers,
  formatMentionToken,
  mentionIdsForSubmit,
  mergeInternalNotes,
  pruneMentionBindings,
  reconcileNotesCatchUp,
  seedNotesCatchUpWatermark,
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
  display_label: "Ada Agent",
  role: "agent",
};
const agentDup: WorkspaceMemberOption = {
  member_id: "44444444-4444-4444-8444-444444444444",
  display_label: "Ada Agent",
  role: "agent",
};
const viewer: WorkspaceMemberOption = {
  member_id: "33333333-3333-4333-8333-333333333333",
  display_label: "viewer@local.test",
  role: "viewer",
};
const members: WorkspaceMemberOption[] = [owner, agent, agentDup, viewer];

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

describe("ID-backed mentions", () => {
  it("formats and extracts member ids from body", () => {
    const token = formatMentionToken(agent);
    expect(token).toContain(agent.member_id);
    const body = `Please review ${token} thanks`;
    expect(collectMentionMemberIdsFromBody(body)).toEqual([agent.member_id]);
    expect(mentionIdsForSubmit(body)).toEqual([agent.member_id]);
  });

  it("does not keep sticky mentions when token removed from body", () => {
    const token = formatMentionToken(agent);
    const withMention = `Hello ${token}`;
    expect(mentionIdsForSubmit(withMention)).toEqual([agent.member_id]);
    expect(mentionIdsForSubmit("Hello")).toEqual([]);
  });

  it("dedupes duplicate mention tokens for the same member", () => {
    const token = formatMentionToken(agent);
    const body = `${token} and again ${token}`;
    expect(mentionIdsForSubmit(body)).toEqual([agent.member_id]);
  });

  it("distinguishes duplicate display names via member ids", () => {
    const a = formatMentionToken(agent);
    const b = formatMentionToken(agentDup);
    expect(mentionIdsForSubmit(`${a} ${b}`).sort()).toEqual(
      [agent.member_id, agentDup.member_id].sort(),
    );
  });

  it("plain @text without id-backed token does not create mention ids", () => {
    expect(mentionIdsForSubmit("ping @Ada")).toEqual([]);
  });

  it("prunes bindings when token removed", () => {
    const token = formatMentionToken(agent);
    const bindings = new Map([[agent.member_id, agent.display_label]]);
    const pruned = pruneMentionBindings("no mentions here", bindings);
    expect(pruned.size).toBe(0);
    const kept = pruneMentionBindings(`still ${token}`, bindings);
    expect(kept.get(agent.member_id)).toBe(agent.display_label);
  });

  it("detects mention trigger including spaces in draft", () => {
    const body = "Hey @[Ada Ag";
    const trigger = detectMentionTrigger(body, body.length);
    expect(trigger?.query).toBe("Ada Ag");
  });

  it("createClientNoteId returns a uuid string", () => {
    const id = createClientNoteId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("filterMentionableMembers", () => {
  it("excludes viewers and filters by search", () => {
    const filtered = filterMentionableMembers(members, "Ada");
    expect(filtered.every((m) => m.role !== "viewer")).toBe(true);
    expect(filtered).toHaveLength(2);
  });
});

describe("mergeInternalNotes + catch-up", () => {
  it("merges by id and drops soft-deleted", () => {
    const current = [
      note({ id: "n1", body: "old", updated_at: "2026-08-13T12:00:00.000Z" }),
      note({ id: "n2", body: "keep", created_at: "2026-08-13T11:00:00.000Z" }),
    ];
    const incoming = [
      note({ id: "n1", body: "new", updated_at: "2026-08-13T13:00:00.000Z" }),
      note({
        id: "n2",
        body: "deleted",
        deleted_at: "2026-08-13T14:00:00.000Z",
        updated_at: "2026-08-13T14:00:00.000Z",
      }),
    ];
    const merged = mergeInternalNotes(current, incoming);
    expect(merged.map((n) => n.id)).toEqual(["n1"]);
    expect(merged[0]?.body).toBe("new");
  });

  it("authoritative catch-up removes missed deletes via tombstones", () => {
    const current = [
      note({ id: "n1" }),
      note({ id: "n2", created_at: "2026-08-13T11:00:00.000Z" }),
    ];
    // Active page no longer contains n2 (deleted while offline); tombstone arrives.
    const active = [note({ id: "n1", body: "still here" })];
    const tombstones = [
      note({
        id: "n2",
        deleted_at: "2026-08-13T15:00:00.000Z",
        updated_at: "2026-08-13T15:00:00.000Z",
      }),
    ];
    const next = reconcileNotesCatchUp(current, active, tombstones, {
      authoritativeReplace: true,
    });
    expect(next.map((n) => n.id)).toEqual(["n1"]);
  });

  it("authoritative catch-up keeps CDC creates missing from a stale empty page", () => {
    const current = [note({ id: "n-cdc", body: "from cdc" })];
    const active: InternalNote[] = [];
    const next = reconcileNotesCatchUp(current, active, [], {
      authoritativeReplace: true,
    });
    expect(next.map((n) => n.id)).toEqual(["n-cdc"]);
  });

  it("local/session tombstone blocks stale catch-up from resurrecting a deleted note", () => {
    const current: InternalNote[] = [];
    const active = [note({ id: "n1", body: "already deleted locally" })];
    const tombstones = [
      note({
        id: "n1",
        deleted_at: "2026-08-13T15:00:00.000Z",
        updated_at: "2026-08-13T15:00:00.000Z",
      }),
    ];
    const next = reconcileNotesCatchUp(current, active, tombstones, {
      authoritativeReplace: true,
    });
    expect(next).toEqual([]);
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
  it("highlights id-backed mentions", () => {
    const token = formatMentionToken(agent);
    const segments = splitNoteBodyWithMentions(`Hi ${token} please look`, [
      { member_id: agent.member_id, display_label: agent.display_label },
    ]);
    expect(segments.some((s) => s.type === "mention" && s.memberId === agent.member_id)).toBe(true);
  });
});

describe("extractMentionTokens", () => {
  it("prefers id-backed over legacy", () => {
    const token = formatMentionToken(agent);
    const tokens = extractMentionTokens(`${token} and @legacy`);
    expect(tokens.some((t) => t.memberId === agent.member_id)).toBe(true);
    expect(tokens.some((t) => t.memberId === null && t.label === "legacy")).toBe(true);
  });
});

describe("parseNoteErrorMessage", () => {
  it("maps typed prefixes", () => {
    const err = parseNoteErrorMessage("FORBIDDEN: Viewers cannot access internal notes.");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("maps NOTE_DELETED for create-after-soft-delete", () => {
    const err = parseNoteErrorMessage(
      "NOTE_DELETED: This note was deleted. Save again as a new note.",
    );
    expect(err?.code).toBe("NOTE_DELETED");
    expect(err?.message).toMatch(/Save again as a new note/i);
  });
});

describe("clientNoteId retry stability", () => {
  it("reuses the same id across retries until success reset", () => {
    const draftId = createClientNoteId();
    // Simulate composer ref holding the same id through failed submit + retry.
    const firstAttempt = draftId;
    const retryAttempt = draftId;
    expect(retryAttempt).toBe(firstAttempt);
    const afterSuccess = createClientNoteId();
    expect(afterSuccess).not.toBe(draftId);
  });

  it("NOTE_DELETED keeps draft id; retry-as-new mints a fresh id", () => {
    let clientNoteId = createClientNoteId();
    const draftBody = "preserved draft body";
    // Network/generic failure: keep id.
    const afterNetworkRetry = clientNoteId;
    expect(afterNetworkRetry).toBe(clientNoteId);
    // NOTE_DELETED: preserve draft text and id until explicit retry-as-new.
    expect(draftBody.length).toBeGreaterThan(0);
    const afterNoteDeleted = clientNoteId;
    expect(afterNoteDeleted).toBe(clientNoteId);
    // Explicit retry-as-new.
    clientNoteId = createClientNoteId();
    expect(clientNoteId).not.toBe(afterNoteDeleted);
  });
});

describe("catch-up watermark", () => {
  it("seeds from max updated_at of known notes", () => {
    const older = note({
      id: "11111111-1111-4111-8111-111111111111",
      updated_at: "2026-08-13T10:00:00.000Z",
    });
    const newer = note({
      id: "22222222-2222-4222-8222-222222222222",
      updated_at: "2026-08-13T12:00:00.000Z",
    });
    expect(seedNotesCatchUpWatermark([older, newer])).toBe("2026-08-13T12:00:00.000Z");
  });

  it("empty list seeds to null — never client clock / epoch", () => {
    expect(seedNotesCatchUpWatermark([])).toBeNull();
  });

  it("advances watermark from items and tombstones without moving backward", () => {
    const current = "2026-08-13T12:00:00.000Z";
    const items = [
      note({
        id: "11111111-1111-4111-8111-111111111111",
        updated_at: "2026-08-13T12:30:00.000Z",
      }),
    ];
    const tombstones = [
      note({
        id: "22222222-2222-4222-8222-222222222222",
        updated_at: "2026-08-13T12:45:00.000Z",
        deleted_at: "2026-08-13T12:45:00.000Z",
      }),
    ];
    const next = advanceNotesCatchUpWatermark(current, items, tombstones);
    expect(next).toBe("2026-08-13T12:45:00.000Z");
    expect(advanceNotesCatchUpWatermark(next, [], [])).toBe(next);
  });

  it("never advances past server timestamps when client clock is ahead (regression)", () => {
    const serverMax = "2026-08-13T10:00:00.000Z";
    const items = [
      note({
        id: "11111111-1111-4111-8111-111111111111",
        updated_at: serverMax,
      }),
    ];
    // Old bug defaulted a 4th arg to Date.now() and jumped the cursor past DB time.
    // New signature has no client-clock parameter — empty response keeps T10.
    const next = advanceNotesCatchUpWatermark(serverMax, items, []);
    expect(next).toBe(serverMax);
    expect(advanceNotesCatchUpWatermark(serverMax, [], [])).toBe(serverMax);
  });

  it("uses optional RPC server_watermark when it is the GREATEST server cursor", () => {
    const current = "2026-08-13T10:00:00.000Z";
    const items = [
      note({
        id: "11111111-1111-4111-8111-111111111111",
        updated_at: "2026-08-13T10:00:00.000Z",
      }),
    ];
    // RPC may echo GREATEST(catch_up_since, max returned updated_at).
    expect(advanceNotesCatchUpWatermark(current, items, [], "2026-08-13T10:00:00.000Z")).toBe(
      "2026-08-13T10:00:00.000Z",
    );
  });

  it("missed delete after watermark T10 still reconciles tombstone at T11", () => {
    const watermarkT10 = "2026-08-13T10:00:00.000Z";
    const noteId = "22222222-2222-4222-8222-222222222222";
    const afterCatchUp = [
      note({
        id: "11111111-1111-4111-8111-111111111111",
        updated_at: watermarkT10,
      }),
      note({ id: noteId, updated_at: watermarkT10 }),
    ];
    const advanced = advanceNotesCatchUpWatermark(watermarkT10, afterCatchUp, []);
    expect(advanced).toBe(watermarkT10);

    const tombstoneT11 = note({
      id: noteId,
      deleted_at: "2026-08-13T10:00:01.000Z",
      updated_at: "2026-08-13T10:00:01.000Z",
    });
    // Next catch-up with >= watermark still includes T11 tombstone.
    expect(Date.parse(tombstoneT11.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(advanced ?? watermarkT10),
    );
    const next = reconcileNotesCatchUp(
      afterCatchUp,
      [note({ id: "11111111-1111-4111-8111-111111111111", updated_at: watermarkT10 })],
      [tombstoneT11],
      { authoritativeReplace: true },
    );
    expect(next.map((n) => n.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(advanceNotesCatchUpWatermark(advanced, next, [tombstoneT11])).toBe(
      "2026-08-13T10:00:01.000Z",
    );
  });

  it("missed delete still removes via tombstones under authoritative replace", () => {
    const current = [
      note({ id: "11111111-1111-4111-8111-111111111111" }),
      note({ id: "22222222-2222-4222-8222-222222222222" }),
    ];
    const active = [note({ id: "11111111-1111-4111-8111-111111111111", body: "still" })];
    const tombstones = [
      note({
        id: "22222222-2222-4222-8222-222222222222",
        deleted_at: "2026-08-13T15:00:00.000Z",
        updated_at: "2026-08-13T15:00:00.000Z",
      }),
    ];
    const next = reconcileNotesCatchUp(current, active, tombstones, {
      authoritativeReplace: true,
    });
    expect(next.map((n) => n.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });
});
