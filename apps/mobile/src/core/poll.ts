// Wait for each response before scheduling another request. Slow networks must
// not continually invalidate the response that is still in flight.
export function startPolling(
  refresh: () => Promise<unknown>,
  interval?: number,
  schedule: (callback: () => void, delay: number) => () => void = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
) {
  let cancelled = false;
  let cancelTimer: (() => void) | undefined;
  const poll = async () => {
    if (cancelled) return;
    try {
      await refresh();
    } finally {
      if (!cancelled && interval)
        cancelTimer = schedule(() => void poll().catch(() => {}), interval);
    }
  };
  void poll().catch(() => {});
  return () => {
    cancelled = true;
    cancelTimer?.();
  };
}
