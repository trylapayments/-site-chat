/**
 * Coalesces visitor CDC bursts without entering Next's navigation/action queue.
 * A change invalidates an in-flight snapshot immediately, not only when the
 * next debounced request starts. Failed reads retry while the view is mounted.
 */
export function createVisitorContextRefresh<T>(input: {
  read: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onError: (error: unknown) => void;
}) {
  let active = true;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const read = async () => {
    const requestRevision = revision;
    try {
      const snapshot = await input.read();
      if (!active || requestRevision !== revision) return;
      retryDelay = 1000;
      input.onSnapshot(snapshot);
    } catch (error) {
      if (!active || requestRevision !== revision) return;
      input.onError(error);
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  };

  return {
    schedule() {
      if (!active) return;
      revision += 1;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, 250);
    },
    async refresh() {
      if (!active) return;
      clearTimer();
      revision += 1;
      await read();
    },
    stop() {
      active = false;
      revision += 1;
      clearTimer();
    },
  };
}
