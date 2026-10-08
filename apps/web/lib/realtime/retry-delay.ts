/** Spread reconnects across time after a shared outage; keep retries bounded. */
export function realtimeRetryDelay(
  attempt: number,
  random = Math.random,
): number {
  const ceiling = Math.min(
    1000 * 2 ** Math.min(Math.max(0, attempt), 10),
    15000,
  );
  return Math.round(ceiling * (0.5 + Math.min(1, Math.max(0, random())) * 0.5));
}
