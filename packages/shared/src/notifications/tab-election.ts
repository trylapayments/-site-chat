/**
 * Multi-tab side-effect election for browser/sound notifications.
 * Exactly one tab should play sound / show desktop notifications to avoid storms.
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

type StorageLike = {
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

function getLocalStorage(): StorageLike | null {
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

function readLeader(key: string): { tabId: string; at: number } | null {
  const storage = getLocalStorage();
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

function writeLeader(key: string, tabId: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify({ tabId, at: now() }));
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
  options?: { tabId?: string; nowFn?: () => number },
): TabElection {
  const tabId =
    options?.tabId ?? `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const key = `${LEADER_KEY_PREFIX}${workspaceId}`;
  const clock = options?.nowFn ?? now;
  let disposed = false;
  let leader = false;

  const claimIfNeeded = (): void => {
    if (disposed) {
      return;
    }
    const current = readLeader(key);
    if (!current || current.tabId === tabId || clock() - current.at > STALE_MS) {
      writeLeader(key, tabId);
      leader = true;
      return;
    }
    leader = false;
  };

  claimIfNeeded();

  const interval =
    typeof setInterval === "function"
      ? setInterval(() => {
          if (disposed) {
            return;
          }
          const current = readLeader(key);
          if (leader || !current || clock() - current.at > STALE_MS) {
            writeLeader(key, tabId);
            leader = true;
          } else if (current.tabId === tabId) {
            writeLeader(key, tabId);
            leader = true;
          } else {
            leader = false;
          }
        }, HEARTBEAT_MS)
      : null;

  const onStorage = (event: StorageEventLike): void => {
    if (event.key !== key || disposed) {
      return;
    }
    const current = readLeader(key);
    leader = Boolean(current && current.tabId === tabId);
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
      if (!getLocalStorage()) {
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
      const current = readLeader(key);
      if (current?.tabId === tabId) {
        const storage = getLocalStorage();
        try {
          storage?.removeItem(key);
        } catch {
          // ignore
        }
      }
    },
  };
}

export const NOTIFICATION_TAB_HEARTBEAT_MS = HEARTBEAT_MS;
export const NOTIFICATION_TAB_STALE_MS = STALE_MS;
