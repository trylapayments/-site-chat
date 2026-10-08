/** Distance from the bottom (px) treated as "still following" the live feed. */
export const NEAR_BOTTOM_THRESHOLD_PX = 100;

/**
 * Returns true when the scroll container is within `thresholdPx` of the bottom.
 */
export function isNearBottom(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= thresholdPx;
}

/**
 * Decide whether to auto-scroll after a message list update.
 * - `force`: visitor's own send / initial load — always reveal the newest bubble
 * - otherwise: only when the user is already near the bottom
 */
export function shouldAutoScroll(input: { force: boolean; nearBottom: boolean }): boolean {
  return input.force || input.nearBottom;
}

export function scrollContainerToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}
