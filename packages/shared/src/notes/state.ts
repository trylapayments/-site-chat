import type { WorkspaceMemberOption } from "../schemas/conversation.js";
import type { InternalNote } from "../schemas/internal-notes.js";

/** Match @tokens: @Alice, @alice@example.com, @"Display Name" not required for v1. */
const MENTION_TOKEN_RE = /@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;

export type MentionTokenMatch = {
  raw: string;
  token: string;
  start: number;
  end: number;
};

/**
 * Extract @mention tokens from note body (no resolution).
 */
export function extractMentionTokens(body: string): MentionTokenMatch[] {
  const matches: MentionTokenMatch[] = [];
  const re = new RegExp(MENTION_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const token = match[1] ?? "";
    if (!token) continue;
    matches.push({
      raw: match[0],
      token,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function localPart(emailOrLabel: string): string {
  const at = emailOrLabel.indexOf("@");
  if (at <= 0) return emailOrLabel;
  return emailOrLabel.slice(0, at);
}

/**
 * Resolve @tokens against workspace members (messaging roles).
 * Ambiguous tokens (multiple matches) are skipped — UI should pass explicit member ids.
 */
export function resolveMentionMemberIds(body: string, members: WorkspaceMemberOption[]): string[] {
  const mentionable = members.filter(
    (m) => m.role === "owner" || m.role === "admin" || m.role === "agent",
  );
  const ids = new Set<string>();

  for (const { token } of extractMentionTokens(body)) {
    const needle = normalizeLabel(token);
    const matches = mentionable.filter((member) => {
      const label = normalizeLabel(member.display_label);
      if (label === needle) return true;
      if (localPart(label) === needle) return true;
      return false;
    });
    if (matches.length === 1) {
      const match = matches[0];
      if (match) {
        ids.add(match.member_id);
      }
    }
  }

  return [...ids];
}

/**
 * Merge explicit picker ids with body-resolved ids (union, stable unique).
 */
export function mergeMentionMemberIds(
  explicitIds: readonly string[] | undefined,
  body: string,
  members: WorkspaceMemberOption[],
): string[] {
  const resolved = resolveMentionMemberIds(body, members);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(explicitIds ?? []), ...resolved]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Filter mentionable members for @autocomplete (substring on display_label).
 */
export function filterMentionableMembers(
  members: WorkspaceMemberOption[],
  search: string,
): WorkspaceMemberOption[] {
  const needle = search.trim().toLowerCase();
  let list = members.filter(
    (member) => member.role === "owner" || member.role === "admin" || member.role === "agent",
  );
  if (needle) {
    list = list.filter((member) => member.display_label.toLowerCase().includes(needle));
  }
  return list;
}

/**
 * Merge note lists by id (reconnect / realtime). Prefer newer updated_at.
 * Soft-deleted notes (deleted_at set) are removed unless includeDeleted.
 */
export function mergeInternalNotes(
  current: InternalNote[],
  incoming: InternalNote[],
  options: { includeDeleted?: boolean } = {},
): InternalNote[] {
  const byId = new Map<string, InternalNote>();

  for (const note of current) {
    byId.set(note.id, note);
  }

  for (const note of incoming) {
    const existing = byId.get(note.id);
    if (!existing) {
      byId.set(note.id, note);
      continue;
    }
    const existingUpdated = Date.parse(existing.updated_at);
    const incomingUpdated = Date.parse(note.updated_at);
    if (
      Number.isFinite(incomingUpdated) &&
      (!Number.isFinite(existingUpdated) || incomingUpdated >= existingUpdated)
    ) {
      byId.set(note.id, note);
    }
  }

  let notes = [...byId.values()];
  if (!options.includeDeleted) {
    notes = notes.filter((note) => !note.deleted_at);
  }

  notes.sort((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });

  return notes;
}

/**
 * Apply a realtime CDC row to the note list (INSERT or UPDATE including soft delete).
 */
export function applyInternalNoteRealtimeChange(
  current: InternalNote[],
  note: InternalNote,
): InternalNote[] {
  return mergeInternalNotes(current, [note], { includeDeleted: false });
}

/**
 * Highlight @mentions in body for display. Returns segments for rich rendering.
 */
export function splitNoteBodyWithMentions(
  body: string,
  mentions: Array<{ member_id: string; display_label: string }>,
): Array<{ type: "text" | "mention"; text: string; memberId?: string }> {
  const tokens = extractMentionTokens(body);
  if (tokens.length === 0) {
    return [{ type: "text", text: body }];
  }

  const labelToMember = new Map<string, string>();
  for (const mention of mentions) {
    const label = normalizeLabel(mention.display_label);
    labelToMember.set(label, mention.member_id);
    labelToMember.set(normalizeLabel(localPart(mention.display_label)), mention.member_id);
  }

  const segments: Array<{ type: "text" | "mention"; text: string; memberId?: string }> = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ type: "text", text: body.slice(cursor, token.start) });
    }
    const memberId = labelToMember.get(normalizeLabel(token.token));
    if (memberId) {
      segments.push({ type: "mention", text: token.raw, memberId });
    } else {
      segments.push({ type: "text", text: token.raw });
    }
    cursor = token.end;
  }
  if (cursor < body.length) {
    segments.push({ type: "text", text: body.slice(cursor) });
  }
  return segments;
}
