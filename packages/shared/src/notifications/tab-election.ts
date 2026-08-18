/**
 * Multi-tab side-effect election for browser/sound notifications.
 * Exactly one tab should play sound / show desktop notifications to avoid storms.
 *
 * Lease ownership uses post-write verification:
 * 1. read current lease
 * 2. if free/stale, write {tabId, at}
 * 3. read back — leader ONLY if stored tabId === own tabId
 * 4. heartbeat only while storage still says own tabId
 *
 * Uses globalThis only (no DOM lib dependency) so this package builds in Node.
 */

const LEADER_KEY_PREFIX = "sitechat:notif-leader:";
const HEARTBEAT_MS = 2_000;
const STALE_MS = 5_000;

export type TabElection = {
  tabId: string;
  isLeader: () => boolean;
  dispose: () => void;
};

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type StorageEventLike = {
  key: string | null;
};

function now(): number {
  return Date.now();
}

function getDefaultLocalStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!storage) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

function readLeader(
  storage: StorageLike | null,
  key: string,
): { tabId: string; at: number } | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { tabId?: unknown; at?: unknown };
    if (typeof parsed.tabId !== "string" || typeof parsed.at !== "number") {
      return null;
    }
    return { tabId: parsed.tabId, at: parsed.at };
  } catch {
    return null;
  }
}

function writeLeader(
  storage: StorageLike | null,
  key: string,
  tabId: string,
  clock: () => number,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify({ tabId, at: clock() }));
  } catch {
    // Ignore quota / private mode.
  }
}

/**
 * Elect a leader tab per workspace using localStorage heartbeats.
 * Falls back to "this tab is leader" when storage is unavailable.
 */
export function createNotificationTabElection(
  workspaceId: string,
  options?: {
    tabId?: string;
    nowFn?: () => number;
    /** Injectable storage for tests; defaults to localStorage. */
    storage?: StorageLike | null;
  },
): TabElection {
  const tabId =
    options?.tabId ?? `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const key = `${LEADER_KEY_PREFIX}${workspaceId}`;
  const clock = options?.nowFn ?? now;
  const resolvedStorage =
    options && "storage" in options ? (options.storage ?? null) : getDefaultLocalStorage();
  let disposed = false;
  let leader = false;

  const verifyOwnership = (): boolean => {
    const current = readLeader(resolvedStorage, key);
    return Boolean(current && current.tabId === tabId);
  };

  const tryClaim = (): void => {
    if (disposed) {
      return;
    }
    if (!resolvedStorage) {
      leader = true;
      return;
    }

    const current = readLeader(resolvedStorage, key);
    const freeOrStale = !current || current.tabId === tabId || clock() - current.at > STALE_MS;

    if (!freeOrStale) {
      leader = false;
      return;
    }

    writeLeader(resolvedStorage, key, tabId, clock);
    // Post-write verification: last writer wins under race.
    leader = verifyOwnership();
  };

  const heartbeat = (): void => {
    if (disposed) {
      return;
    }
    if (!resolvedStorage) {
      leader = true;
      return;
    }

    const current = readLeader(resolvedStorage, key);
    if (current?.tabId === tabId) {
      writeLeader(resolvedStorage, key, tabId, clock);
      leader = verifyOwnership();
      return;
    }

    if (!current || clock() - current.at > STALE_MS) {
      writeLeader(resolvedStorage, key, tabId, clock);
      leader = verifyOwnership();
      return;
    }

    leader = false;
  };

  tryClaim();

  const interval =
    typeof setInterval === "function"
      ? setInterval(() => {
          heartbeat();
        }, HEARTBEAT_MS)
      : null;

  const onStorage = (event: StorageEventLike): void => {
    if (event.key !== key || disposed) {
      return;
    }
    leader = verifyOwnership();
  };

  const target = globalThis as {
    addEventListener?: (type: string, listener: (event: StorageEventLike) => void) => void;
    removeEventListener?: (type: string, listener: (event: StorageEventLike) => void) => void;
  };

  if (typeof target.addEventListener === "function") {
    target.addEventListener("storage", onStorage);
  }

  return {
    tabId,
    isLeader: () => {
      if (disposed) {
        return false;
      }
      // Storage unavailable → allow side effects (single-tab assumption).
      if (!resolvedStorage) {
        return true;
      }
      return leader;
    },
    dispose: () => {
      disposed = true;
      if (interval) {
        clearInterval(interval);
      }
      if (typeof target.removeEventListener === "function") {
        target.removeEventListener("storage", onStorage);
      }
      const current = readLeader(resolvedStorage, key);
      if (current?.tabId === tabId) {
        try {
          resolvedStorage?.removeItem(key);
        } catch {
          // ignore
        }
      }
      leader = false;
    },
  };
}

export const NOTIFICATION_TAB_HEARTBEAT_MS = HEARTBEAT_MS;
export const NOTIFICATION_TAB_STALE_MS = STALE_MS;
