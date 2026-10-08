const DAY = 86_400_000;
export type ReviewProgress = {
  firstUse: number;
  closed: string[];
  lastClosed?: number;
  lastAttempt?: number;
};
export function recordReviewClose(
  progress: ReviewProgress,
  id: string,
  now: number,
): ReviewProgress {
  if (progress.closed.includes(id)) return progress;
  return { ...progress, closed: [...progress.closed, id].slice(-100), lastClosed: now };
}
export function reviewEligible(progress: ReviewProgress, now: number): boolean {
  return (
    now >= progress.firstUse + 7 * DAY &&
    progress.closed.length >= 5 &&
    progress.lastClosed !== undefined &&
    now >= progress.lastClosed &&
    now - progress.lastClosed <= DAY &&
    (progress.lastAttempt === undefined || now - progress.lastAttempt >= 120 * DAY)
  );
}
