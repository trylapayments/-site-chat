import type { WorkspaceMemberOption } from "../schemas/conversation.js";
import type { InternalNote } from "../schemas/internal-notes.js";

/**
 * ID-backed mention token: @[Display Label](member:<uuid>)
 * Display labels may contain spaces; member id is the only identity.
 */
export const ID_BACKED_MENTION_RE =
  /@\[([^\]]+)\]\(member:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MentionTokenMatch = {
  raw: string;
  /** Display label inside brackets, or legacy bare token. */
  label: string;
  memberId: string | null;
  start: number;
  end: number;
};

export function formatMentionToken(member: { member_id: string; display_label: string }): string {
  const label = member.display_label.replace(/[[\]]/g, "").trim() || "member";
  return `@[${label}](member:${member.member_id})`;
}

/**
 * Extract mention tokens from note body (ID-backed preferred; legacy @token supported for display).
 */
export function extractMentionTokens(body: string): MentionTokenMatch[] {
  const matches: MentionTokenMatch[] = [];
  const idRe = new RegExp(ID_BACKED_MENTION_RE.source, "gi");
  let match: RegExpExecArray | null;
  const covered = new Set<string>();

  while ((match = idRe.exec(body)) !== null) {
    const label = match[1] ?? "";
    const memberId = match[2] ?? "";
    if (!label || !UUID_RE.test(memberId)) continue;
    const key = `${String(match.index)}:${String(match[0].length)}`;
    covered.add(key);
    matches.push({
      raw: match[0],
      label,
      memberId,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Legacy bare @tokens for display-only highlighting of unresolved text.
  const legacyRe = /@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;
  while ((match = legacyRe.exec(body)) !== null) {
    const start = match.index;
    const raw = match[0];
    const key = `${String(start)}:${String(raw.length)}`;
    if (covered.has(key)) continue;
    const insideIdBacked = matches.some((m) => start >= m.start && start < m.end);
    if (insideIdBacked) continue;
    matches.push({
      raw,
      label: match[1] ?? "",
      memberId: null,
      start,
      end: start + raw.length,
    });
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/**
 * Collect mention member ids currently present in the body.
 * Only ID-backed tokens count — never unions with previously persisted mention rows.
 * Duplicate occurrences of the same member collapse to one id.
 */
export function collectMentionMemberIdsFromBody(body: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const token of extractMentionTokens(body)) {
    if (!token.memberId) continue;
    if (seen.has(token.memberId)) continue;
    seen.add(token.memberId);
    ids.push(token.memberId);
  }
  return ids;
}

/**
 * Whether the autocomplete trigger is active at caret.
 * Supports queries with spaces while composing `@[partial`.
 */
export function detectMentionTrigger(
  body: string,
  caret: number,
): { query: string; replaceStart: number } | null {
  const before = body.slice(0, caret);
  // Prefer incomplete ID-backed draft: @[partial
  const draft = /(?:^|[\s])(@\[[^\]]*)$/.exec(before);
  if (draft) {
    const atIdx = before.lastIndexOf("@[");
    if (atIdx >= 0) {
      return {
        query: before.slice(atIdx + 2),
        replaceStart: atIdx,
      };
    }
  }
  // Bare @query (no spaces in query until user picks)
  const bare = /(?:^|[\s])@([^\s@[\]]*)$/.exec(before);
  if (bare) {
    const atIdx = before.lastIndexOf("@");
    if (atIdx >= 0) {
      return {
        query: before.slice(atIdx + 1),
        replaceStart: atIdx,
      };
    }
  }
  return null;
}

/**
 * Filter mentionable members for @autocomplete (active messaging roles only).
 */
export function filterMentionableMembers(
  members: WorkspaceMemberOption[],
  search: string,
): WorkspaceMemberOption[] {
  const needle = search.trim().toLowerCase();
  let list = members.filter(
    (member) =>
      (member.role === "owner" || member.role === "admin" || member.role === "agent") &&
      // Deactivated members should not appear in picker (list_assignable_members already filters).
      Boolean(member.member_id && member.display_label),
  );
  if (needle) {
    list = list.filter((member) => member.display_label.toLowerCase().includes(needle));
  }
  return list;
}

/**
 * @deprecated Prefer collectMentionMemberIdsFromBody — kept for tests migrating off label resolution.
 * Resolves only unambiguous legacy bare tokens; never invents mentions from persisted rows.
 */
export function resolveMentionMemberIds(body: string, members: WorkspaceMemberOption[]): string[] {
  // ID-backed tokens take precedence.
  const fromTokens = collectMentionMemberIdsFromBody(body);
  if (fromTokens.length > 0) {
    return fromTokens;
  }

  const mentionable = members.filter(
    (m) => m.role === "owner" || m.role === "admin" || m.role === "agent",
  );
  const ids = new Set<string>();
  for (const token of extractMentionTokens(body)) {
    if (token.memberId) {
      ids.add(token.memberId);
      continue;
    }
    const needle = token.label.trim().toLowerCase();
    const matches = mentionable.filter((member) => {
      const label = member.display_label.trim().toLowerCase();
      if (label === needle) return true;
      const at = label.indexOf("@");
      if (at > 0 && label.slice(0, at) === needle) return true;
      return false;
    });
    if (matches.length === 1 && matches[0]) {
      ids.add(matches[0].member_id);
    }
  }
  return [...ids];
}

export function mentionIdsForSubmit(body: string): string[] {
  return collectMentionMemberIdsFromBody(body);
}

/**
 * @deprecated Use mentionIdsForSubmit(body). Explicit bindings are no longer unioned
 * with body text — only ID-backed tokens in the current body are submitted.
 */
export function mergeMentionMemberIds(
  _explicitIds: readonly string[] | undefined,
  body: string,
  _members?: WorkspaceMemberOption[],
): string[] {
  return mentionIdsForSubmit(body);
}

/**
 * Prune binding map entries whose member id no longer appears in the body.
 */
export function pruneMentionBindings(
  body: string,
  bindings: ReadonlyMap<string, string>,
): Map<string, string> {
  const present = new Set(collectMentionMemberIdsFromBody(body));
  const next = new Map<string, string>();
  for (const [memberId, label] of bindings) {
    if (present.has(memberId)) {
      next.set(memberId, label);
    }
  }
  // Also add any ID-backed tokens found in body.
  for (const token of extractMentionTokens(body)) {
    if (token.memberId) {
      next.set(token.memberId, token.label);
    }
  }
  return next;
}

/**
 * Merge note lists by id. Soft-deleted notes remove the id unless includeDeleted.
 * When `authoritative` is true, incoming is the full source of truth for active notes
 * and any current id absent from incoming (and not in tombstoneIncoming) is dropped
 * only when `replaceActive` is set — prefer `reconcileNotesCatchUp` for reconnect.
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
 * Reconnect catch-up: merge active notes + tombstones (deleted_at set).
 * Tombstones remove ids even when the truncated active page still "misses" them.
 */
export function reconcileNotesCatchUp(
  current: InternalNote[],
  activeIncoming: InternalNote[],
  tombstones: InternalNote[],
  options: { authoritativeReplace?: boolean } = {},
): InternalNote[] {
  const deletedIds = new Set(tombstones.filter((n) => n.deleted_at).map((n) => n.id));

  if (options.authoritativeReplace) {
    const byId = new Map<string, InternalNote>();
    // Server active page is the base for reconnect.
    for (const note of activeIncoming) {
      if (!note.deleted_at && !deletedIds.has(note.id)) {
        byId.set(note.id, note);
      }
    }
    // Keep CDC arrivals that landed while catch-up was in flight. Missed
    // deletes are removed via tombstones — never by mere absence from a
    // truncated active page.
    for (const note of current) {
      if (note.deleted_at || deletedIds.has(note.id)) continue;
      if (!byId.has(note.id)) {
        byId.set(note.id, note);
      }
    }
    return [...byId.values()].sort((a, b) => {
      const aTime = Date.parse(a.created_at);
      const bTime = Date.parse(b.created_at);
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });
  }

  const merged = mergeInternalNotes(current, activeIncoming, { includeDeleted: true });
  return merged.filter((note) => !note.deleted_at && !deletedIds.has(note.id));
}

export function applyInternalNoteRealtimeChange(
  current: InternalNote[],
  note: InternalNote,
): InternalNote[] {
  return mergeInternalNotes(current, [note], { includeDeleted: false });
}

/**
 * Highlight mentions for display (ID-backed + known mention rows).
 */
export function splitNoteBodyWithMentions(
  body: string,
  mentions: Array<{ member_id: string; display_label: string }> = [],
): Array<{ type: "text" | "mention"; text: string; memberId?: string }> {
  const tokens = extractMentionTokens(body);
  if (tokens.length === 0) {
    return [{ type: "text", text: body }];
  }

  const mentionIds = new Set(mentions.map((m) => m.member_id));

  const segments: Array<{ type: "text" | "mention"; text: string; memberId?: string }> = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ type: "text", text: body.slice(cursor, token.start) });
    }
    if (token.memberId && (mentionIds.size === 0 || mentionIds.has(token.memberId))) {
      segments.push({
        type: "mention",
        text: `@${token.label}`,
        memberId: token.memberId,
      });
    } else if (token.memberId) {
      segments.push({
        type: "mention",
        text: `@${token.label}`,
        memberId: token.memberId,
      });
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

/** Stable client note id helpers for create idempotency. */
export function createClientNoteId(): string {
  return crypto.randomUUID();
}

/**
 * Seed catch-up watermark from known notes (SSR / local state).
 * Uses max server `updated_at` only — never the browser clock.
 * Empty list → null (omit `catch_up_since` so tombstone scans stay empty,
 * not lifetime-unbounded).
 */
export function seedNotesCatchUpWatermark(notes: readonly InternalNote[]): string | null {
  let maxMs = Number.NaN;
  for (const note of notes) {
    const updated = Date.parse(note.updated_at);
    if (Number.isFinite(updated) && (!Number.isFinite(maxMs) || updated > maxMs)) {
      maxMs = updated;
    }
  }
  if (!Number.isFinite(maxMs)) {
    return null;
  }
  return new Date(maxMs).toISOString();
}

/**
 * Advance the catch-up watermark after a successful authoritative response.
 *
 * The watermark is a **database cursor**, never a client clock.
 * Result = MAX(previous, returned active updated_at, returned tombstone
 * updated_at, optional RPC `server_watermark`). Never uses Date.now() /
 * request end time — advancing past DB time can permanently skip deletes.
 */
export function advanceNotesCatchUpWatermark(
  currentWatermark: string | null | undefined,
  items: readonly InternalNote[],
  tombstones: readonly InternalNote[] = [],
  serverWatermark?: string | null,
): string | null {
  let maxMs = Number.NaN;

  if (currentWatermark) {
    const currentMs = Date.parse(currentWatermark);
    if (Number.isFinite(currentMs)) {
      maxMs = currentMs;
    }
  }

  if (serverWatermark) {
    const serverMs = Date.parse(serverWatermark);
    if (Number.isFinite(serverMs) && (!Number.isFinite(maxMs) || serverMs > maxMs)) {
      maxMs = serverMs;
    }
  }

  for (const note of [...items, ...tombstones]) {
    const updated = Date.parse(note.updated_at);
    if (Number.isFinite(updated) && (!Number.isFinite(maxMs) || updated > maxMs)) {
      maxMs = updated;
    }
  }

  if (!Number.isFinite(maxMs)) {
    return null;
  }
  return new Date(maxMs).toISOString();
}
