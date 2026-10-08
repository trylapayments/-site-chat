import { recordStartupStage } from "@/lib/performance/interactions";
export type ResourceSnapshot<T = unknown> = {
  data?: T;
  loading: boolean;
  error?: string;
};
const empty: ResourceSnapshot = { loading: false };
export function createResourceStore(fetcher: typeof fetch = fetch) {
  const values = new Map<string, ResourceSnapshot>();
  const listeners = new Set<() => void>();
  const flights = new Map<string, AbortController>();
  let epoch = 0;
  const bootstraps = new Map<string, Promise<void>>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const trim = () => {
    if (values.size <= 64) return;
    for (const key of values.keys()) {
      const workspaceResource =
        /^\/api\/portal\/[^/]+\/(overview|inbox|visitors|visitor-settings)$/.test(
          key,
        );
      if (!flights.has(key) && !workspaceResource) values.delete(key);
      if (values.size <= 64) break;
    }
  };
  const clear = () => {
    epoch++;
    for (const flight of flights.values()) flight.abort();
    flights.clear();
    bootstraps.clear();
    values.clear();
    emit();
  };
  return {
    clear,
    prime(key: string, promise: Promise<unknown>) {
      const generation = epoch;
      const pending = Promise.resolve(promise)
        .then(
          (data) => {
            if (generation !== epoch || values.get(key)?.data !== undefined)
              return;
            values.set(key, {
              ...values.get(key),
              data,
              loading: flights.has(key),
            });
            emit();
          },
          () => {},
        )
        .finally(() => {
          if (bootstraps.get(key) === pending) bootstraps.delete(key);
        });
      bootstraps.set(key, pending);
    },
    // Hydration must read the same baseline used by the server render, even
    // when a streamed seed settles before the browser attaches.
    serverSnapshot: <T>() => empty as ResourceSnapshot<T>,
    snapshot: <T>(key: string) =>
      (values.get(key) ?? empty) as ResourceSnapshot<T>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh(key: string) {
      const generation = epoch;
      const bootstrap = bootstraps.get(key);
      if (bootstrap && values.get(key)?.data === undefined) {
        let fallback: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bootstrap,
            new Promise<void>((resolve) => {
              fallback = setTimeout(resolve, 150);
            }),
          ]);
        } finally {
          if (fallback !== undefined) clearTimeout(fallback);
        }
        if (generation !== epoch || values.get(key)?.data !== undefined) return;
      }
      if (flights.has(key)) return;
      const controller = new AbortController();
      flights.set(key, controller);
      values.set(key, { ...values.get(key), loading: true, error: undefined });
      emit();
      const timer = setTimeout(() => {
        controller.abort();
      }, 15000);
      try {
        if (key.endsWith("/overview"))
          recordStartupStage("Overview HTTP start");
        const response = await fetcher(key, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (generation !== epoch) return;
        if (response.status === 401 || response.status === 403) {
          clear();
          values.set(key, {
            loading: false,
            error: "Session expired or access removed. Please sign in again.",
          });
          emit();
          return;
        }
        if (!response.ok)
          throw new Error("Unable to refresh. Please try again.");
        const data: unknown = await response.json();
        if (key.endsWith("/overview"))
          recordStartupStage("Overview HTTP ready");
        if (generation === epoch) {
          // Move refreshed entries to the end so older threads leave memory first.
          values.delete(key);
          values.set(key, { data, loading: false });
          trim();
        }
      } catch {
        if (generation === epoch)
          values.set(key, {
            ...values.get(key),
            loading: false,
            error: "Unable to refresh. Please try again.",
          });
      } finally {
        clearTimeout(timer);
        if (generation === epoch) {
          flights.delete(key);
          emit();
        }
      }
    },
  };
}
