/**
 * A displayed/generating suggestion becomes stale when realtime delivers a
 * newer visitor message than the one the suggestion was based on.
 */
export function shouldInvalidateSuggestionForVisitorMessage(
  previousVisitorMessageId: string | null,
  nextVisitorMessageId: string | null,
): boolean {
  if (previousVisitorMessageId == null) {
    return false;
  }
  return nextVisitorMessageId !== previousVisitorMessageId;
}
