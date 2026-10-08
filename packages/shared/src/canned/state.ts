import type { CannedFolder, CannedResponse } from "../schemas/canned-responses.js";

type CannedRow = {
  id: string;
  updated_at: string;
  deleted_at?: string | null;
};

function mergeById<T extends CannedRow>(
  current: readonly T[],
  incoming: readonly T[],
  options: { includeDeleted?: boolean },
  compare: (a: T, b: T) => number,
): T[] {
  const byId = new Map<string, T>();

  for (const row of current) {
    byId.set(row.id, row);
  }

  for (const row of incoming) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    const existingUpdated = Date.parse(existing.updated_at);
    const incomingUpdated = Date.parse(row.updated_at);
    if (
      Number.isFinite(incomingUpdated) &&
      (!Number.isFinite(existingUpdated) || incomingUpdated >= existingUpdated)
    ) {
      byId.set(row.id, row);
    }
  }

  let rows = [...byId.values()];
  if (!options.includeDeleted) {
    rows = rows.filter((row) => !row.deleted_at);
  }
  rows.sort(compare);
  return rows;
}

function reconcileCatchUp<T extends CannedRow>(
  current: readonly T[],
  activeIncoming: readonly T[],
  tombstones: readonly T[],
  options: { authoritativeReplace?: boolean },
  compare: (a: T, b: T) => number,
): T[] {
  const deletedIds = new Set(tombstones.filter((row) => row.deleted_at).map((row) => row.id));

  if (options.authoritativeReplace) {
    const byId = new Map<string, T>();
    // The server page is the base for reconnect.
    for (const row of activeIncoming) {
      if (!row.deleted_at && !deletedIds.has(row.id)) {
        byId.set(row.id, row);
      }
    }
    // Keep CDC arrivals that landed while catch-up was in flight. Missed deletes
    // are removed via tombstones — never by mere absence from a truncated page.
    for (const row of current) {
      if (row.deleted_at || deletedIds.has(row.id)) continue;
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
      }
    }
    return [...byId.values()].sort(compare);
  }

  const merged = mergeById(current, activeIncoming, { includeDeleted: true }, compare);
  return merged.filter((row) => !row.deleted_at && !deletedIds.has(row.id));
}

/** Title ascending, then id — matches `list_canned_responses` without `q`. */
export function compareCannedResponses(a: CannedResponse, b: CannedResponse): number {
  const byTitle = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  if (byTitle !== 0) {
    return byTitle;
  }
  return a.id.localeCompare(b.id);
}

/** Visibility, sort_order, name, id — matches `list_canned_response_folders`. */
export function compareCannedFolders(a: CannedFolder, b: CannedFolder): number {
  if (a.visibility !== b.visibility) {
    // 'workspace' < 'personal' in the enum, matching ORDER BY f.visibility.
    return a.visibility === "workspace" ? -1 : 1;
  }
  if (a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}

export function mergeCannedResponses(
  current: readonly CannedResponse[],
  incoming: readonly CannedResponse[],
  options: { includeDeleted?: boolean } = {},
): CannedResponse[] {
  return mergeById(current, incoming, options, compareCannedResponses);
}

export function mergeCannedFolders(
  current: readonly CannedFolder[],
  incoming: readonly CannedFolder[],
  options: { includeDeleted?: boolean } = {},
): CannedFolder[] {
  return mergeById(current, incoming, options, compareCannedFolders);
}

export function applyCannedRealtimeChange(
  current: readonly CannedResponse[],
  item: CannedResponse,
): CannedResponse[] {
  return mergeCannedResponses(current, [item], { includeDeleted: false });
}

export function applyCannedFolderRealtimeChange(
  current: readonly CannedFolder[],
  folder: CannedFolder,
): CannedFolder[] {
  return mergeCannedFolders(current, [folder], { includeDeleted: false });
}

/**
 * Reconnect catch-up: merge the active page with tombstones (deleted_at set).
 * Tombstones remove ids even when a truncated active page still "misses" them.
 */
export function reconcileCannedCatchUp(
  current: readonly CannedResponse[],
  activeIncoming: readonly CannedResponse[],
  tombstones: readonly CannedResponse[],
  options: { authoritativeReplace?: boolean } = {},
): CannedResponse[] {
  return reconcileCatchUp(current, activeIncoming, tombstones, options, compareCannedResponses);
}

export function reconcileCannedFolderCatchUp(
  current: readonly CannedFolder[],
  activeIncoming: readonly CannedFolder[],
  tombstones: readonly CannedFolder[],
  options: { authoritativeReplace?: boolean } = {},
): CannedFolder[] {
  return reconcileCatchUp(current, activeIncoming, tombstones, options, compareCannedFolders);
}

/**
 * Seed a catch-up watermark from known rows (SSR / local state).
 * Uses max server `updated_at` only — never the browser clock. Empty list → null
 * so `catch_up_since` is omitted and tombstone scans stay bounded.
 *
 * Snippets and folders reconcile through separate RPCs, so callers track two
 * watermarks and seed/advance each from its own rows.
 */
export function seedCannedCatchUpWatermark(rows: readonly CannedRow[]): string | null {
  let maxMs = Number.NaN;
  for (const row of rows) {
    const updated = Date.parse(row.updated_at);
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
 * The watermark is a database cursor, never a client clock:
 * MAX(previous, returned rows, returned tombstones, RPC `server_watermark`).
 * Advancing past DB time can permanently skip a concurrent soft delete.
 */
export function advanceCannedCatchUpWatermark(
  currentWatermark: string | null | undefined,
  rows: readonly CannedRow[],
  tombstones: readonly CannedRow[] = [],
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

  for (const row of [...rows, ...tombstones]) {
    const updated = Date.parse(row.updated_at);
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
 * Local tombstone row for an optimistic delete. Keeps an in-flight catch-up that
 * still lists the snippet from resurrecting it.
 */
export function localCannedTombstone(input: { id: string; workspaceId: string }): CannedResponse {
  const now = new Date().toISOString();
  return {
    id: input.id,
    workspace_id: input.workspaceId,
    visibility: "workspace",
    owner_member_id: null,
    owner_display_label: null,
    folder_id: null,
    title: "(deleted)",
    body: "(deleted)",
    shortcut: null,
    usage_count: 0,
    is_favorited: false,
    created_by: null,
    created_by_display_label: null,
    updated_by: null,
    updated_by_display_label: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    deleted_at: now,
  };
}

export function localCannedFolderTombstone(input: {
  id: string;
  workspaceId: string;
}): CannedFolder {
  const now = new Date().toISOString();
  return {
    id: input.id,
    workspace_id: input.workspaceId,
    visibility: "workspace",
    owner_member_id: null,
    owner_display_label: null,
    name: "(deleted)",
    sort_order: 0,
    response_count: 0,
    created_by: null,
    created_by_display_label: null,
    updated_by: null,
    updated_by_display_label: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    deleted_at: now,
  };
}
