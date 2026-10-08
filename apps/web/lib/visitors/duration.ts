export function formatVisitorDuration(start: string, now: number): string {
  const started = Date.parse(start);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return "Unavailable";
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${String(days)}d ${String(hours)}h ${String(minutes)}m`;
  return hours > 0
    ? `${String(hours)}h ${String(minutes)}m`
    : `${String(minutes)}m ${String(seconds % 60)}s`;
}
