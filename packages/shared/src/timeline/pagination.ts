import {
  CUSTOMER_TIMELINE_DEFAULT_PAGE_SIZE,
  CUSTOMER_TIMELINE_MAX_PAGE_SIZE,
  CUSTOMER_TIMELINE_MIN_PAGE_SIZE,
} from "./constants.js";

/**
 * Keyset cursor for customer timeline (newest-first).
 * Ordering: occurred_at DESC, id DESC.
 */
export type CustomerTimelineCursor = {
  occurred_at: string;
  id: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampTimelinePageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return CUSTOMER_TIMELINE_DEFAULT_PAGE_SIZE;
  }
  const n = Math.trunc(limit);
  if (n < CUSTOMER_TIMELINE_MIN_PAGE_SIZE) {
    return CUSTOMER_TIMELINE_MIN_PAGE_SIZE;
  }
  if (n > CUSTOMER_TIMELINE_MAX_PAGE_SIZE) {
    return CUSTOMER_TIMELINE_MAX_PAGE_SIZE;
  }
  return n;
}

export function parseTimelineCursor(raw: unknown): CustomerTimelineCursor | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const occurredAt = record.occurred_at;
  const id = record.id;
  if (typeof occurredAt !== "string" || typeof id !== "string") {
    return null;
  }
  if (Number.isNaN(Date.parse(occurredAt))) {
    return null;
  }
  if (!UUID_RE.test(id)) {
    return null;
  }
  return { occurred_at: occurredAt, id };
}

/**
 * Compare two timeline positions for newest-first ordering.
 * Returns < 0 if a is newer than b, > 0 if a is older, 0 if equal.
 */
export function compareTimelineOrder(
  a: { occurred_at: string; id: string },
  b: { occurred_at: string; id: string },
): number {
  if (a.occurred_at !== b.occurred_at) {
    return a.occurred_at < b.occurred_at ? 1 : -1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? 1 : -1;
}

/**
 * True when `candidate` is strictly older than `cursor` (for load-older).
 */
export function isOlderThanTimelineCursor(
  candidate: { occurred_at: string; id: string },
  cursor: CustomerTimelineCursor,
): boolean {
  return compareTimelineOrder(candidate, cursor) > 0;
}

export function timelineCursorFromEvent(event: {
  occurred_at: string;
  id: string;
}): CustomerTimelineCursor {
  return { occurred_at: event.occurred_at, id: event.id };
}
