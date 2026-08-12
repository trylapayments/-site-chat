import type { CustomerTimelineCursor } from "./pagination.js";

/**
 * Decision after inspecting one catch-up page (newest-first keyset).
 *
 * Catch-up must keep paging with `before` until it overlaps already-loaded
 * event ids — otherwise a disconnect longer than one page permanently skips
 * middle events.
 */
export type TimelineCatchUpPageDecision =
  | { kind: "continue"; nextBefore: CustomerTimelineCursor }
  | { kind: "complete"; reason: "overlap" | "empty-existing" | "empty-page" }
  | { kind: "reload"; reason: "exhausted-without-overlap" };

export function decideTimelineCatchUpPage(input: {
  existingIds: ReadonlySet<string>;
  pageEvents: readonly { id: string }[];
  hasMore: boolean;
  nextBefore: CustomerTimelineCursor | null;
}): TimelineCatchUpPageDecision {
  const { existingIds, pageEvents, hasMore, nextBefore } = input;

  if (existingIds.size === 0) {
    return { kind: "complete", reason: "empty-existing" };
  }

  if (pageEvents.length === 0) {
    return { kind: "complete", reason: "empty-page" };
  }

  for (const event of pageEvents) {
    if (existingIds.has(event.id)) {
      return { kind: "complete", reason: "overlap" };
    }
  }

  if (hasMore && nextBefore) {
    return { kind: "continue", nextBefore };
  }

  return { kind: "reload", reason: "exhausted-without-overlap" };
}

/** Hard cap so a pathological history cannot loop forever on reconnect. */
export const TIMELINE_CATCH_UP_MAX_PAGES = 50;
