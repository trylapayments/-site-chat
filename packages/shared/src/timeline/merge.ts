import type { CustomerTimelineEvent } from "../schemas/timeline.js";
import { compareTimelineOrder } from "./pagination.js";

/**
 * Merge timeline pages / realtime inserts without duplicates or gaps in
 * newest-first order. Reconnect catch-up can re-fetch overlapping rows —
 * this reconciles by id.
 */
export function mergeTimelineEvents(
  existing: CustomerTimelineEvent[],
  incoming: CustomerTimelineEvent[],
): CustomerTimelineEvent[] {
  const byId = new Map<string, CustomerTimelineEvent>();

  for (const event of existing) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    const prior = byId.get(event.id);
    byId.set(event.id, prior ? { ...prior, ...event } : event);
  }

  return [...byId.values()].sort(compareTimelineOrder);
}

/**
 * Prepend a realtime INSERT if newer than the current newest, or merge by id.
 * Ignores events for a different contact.
 */
export function reconcileTimelineRealtimeInsert(
  existing: CustomerTimelineEvent[],
  incoming: CustomerTimelineEvent,
  contactId: string,
): CustomerTimelineEvent[] {
  if (incoming.contact_id !== contactId) {
    return existing;
  }
  return mergeTimelineEvents(existing, [incoming]);
}
