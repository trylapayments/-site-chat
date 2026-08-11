import {
  CONTINUITY_TOKEN_PATTERN,
  isVisitorPublicId,
  resolveWidgetLocale,
  type WidgetLocale,
} from "@site-chat/shared";

const STORAGE_PREFIX = "sitechat:session:";
const VISITOR_STORAGE_PREFIX = "sitechat:visitor:";
const CONTINUITY_STORAGE_PREFIX = "sitechat:continuity:";
const TAB_STORAGE_KEY = "sitechat:tab";
const TAB_ID_MIN_LENGTH = 1;
const TAB_ID_MAX_LENGTH = 64;
const memoryStore = new Map<string, string>();
let memoryTabId: string | null = null;

export function getSessionStorageKey(widgetPublicKey: string): string {
  return `${STORAGE_PREFIX}${widgetPublicKey}`;
}

export function getVisitorStorageKey(widgetPublicKey: string): string {
  return `${VISITOR_STORAGE_PREFIX}${widgetPublicKey}`;
}

export function getContinuityStorageKey(widgetPublicKey: string): string {
  return `${CONTINUITY_STORAGE_PREFIX}${widgetPublicKey}`;
}

export function readSessionToken(widgetPublicKey: string): string | null {
  const storageKey = getSessionStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      // Fall through to in-memory storage.
    }
  }

  return memoryStore.get(storageKey) ?? null;
}

export function writeSessionToken(widgetPublicKey: string, token: string): boolean {
  const storageKey = getSessionStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      localStorage.setItem(storageKey, token);
      return true;
    } catch {
      // Fall through to in-memory storage.
    }
  }

  memoryStore.set(storageKey, token);
  return true;
}

export function clearSessionToken(widgetPublicKey: string): void {
  const storageKey = getSessionStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors.
    }
  }

  memoryStore.delete(storageKey);
}

export function readVisitorPublicId(widgetPublicKey: string): string | null {
  const storageKey = getVisitorStorageKey(widgetPublicKey);
  let value: string | null = null;

  if (isStorageAvailable()) {
    try {
      value = localStorage.getItem(storageKey);
    } catch {
      value = memoryStore.get(storageKey) ?? null;
    }
  } else {
    value = memoryStore.get(storageKey) ?? null;
  }

  if (!value || !isVisitorPublicId(value)) {
    return null;
  }

  return value;
}

export function writeVisitorPublicId(widgetPublicKey: string, visitorPublicId: string): boolean {
  if (!isVisitorPublicId(visitorPublicId)) {
    return false;
  }

  const storageKey = getVisitorStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      localStorage.setItem(storageKey, visitorPublicId);
      return true;
    } catch {
      // Fall through to in-memory storage.
    }
  }

  memoryStore.set(storageKey, visitorPublicId);
  return true;
}

export function clearVisitorPublicId(widgetPublicKey: string): void {
  const storageKey = getVisitorStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors.
    }
  }

  memoryStore.delete(storageKey);
}

/**
 * Opaque continuity token — the cross-session/cross-browser authorization
 * binder for a visitor contact. Unlike `visitorPublicId`, this must never be
 * exposed via host-facing debug APIs; it is persisted purely so the widget
 * can replay it on a future `createSession` call to resume the same
 * contact.
 */
export function readContinuityToken(widgetPublicKey: string): string | null {
  const storageKey = getContinuityStorageKey(widgetPublicKey);
  let value: string | null = null;

  if (isStorageAvailable()) {
    try {
      value = localStorage.getItem(storageKey);
    } catch {
      value = memoryStore.get(storageKey) ?? null;
    }
  } else {
    value = memoryStore.get(storageKey) ?? null;
  }

  if (!value || !CONTINUITY_TOKEN_PATTERN.test(value)) {
    return null;
  }

  return value;
}

export function writeContinuityToken(widgetPublicKey: string, continuityToken: string): boolean {
  if (!CONTINUITY_TOKEN_PATTERN.test(continuityToken)) {
    return false;
  }

  const storageKey = getContinuityStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      localStorage.setItem(storageKey, continuityToken);
      return true;
    } catch {
      // Fall through to in-memory storage.
    }
  }

  memoryStore.set(storageKey, continuityToken);
  return true;
}

export function clearContinuityToken(widgetPublicKey: string): void {
  const storageKey = getContinuityStorageKey(widgetPublicKey);

  if (isStorageAvailable()) {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors.
    }
  }

  memoryStore.delete(storageKey);
}

export function isStorageAvailable(): boolean {
  try {
    const probe = "__sitechat_storage_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function isSessionStorageAvailable(): boolean {
  try {
    const probe = "__sitechat_session_storage_probe__";
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function isValidTabId(value: string): boolean {
  return value.length >= TAB_ID_MIN_LENGTH && value.length <= TAB_ID_MAX_LENGTH;
}

/**
 * Tab-scoped identifier distinguishing concurrent tabs within one browser
 * session — NOT a fingerprinting signal. Backed by `sessionStorage` (cleared
 * when the tab closes) so it stays stable across reloads/navigations within
 * the same tab, with an in-memory fallback when storage is unavailable.
 */
export function getOrCreateTabId(): string {
  if (isSessionStorageAvailable()) {
    try {
      const existing = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (existing && isValidTabId(existing)) {
        return existing;
      }

      const created = generateClientMessageId();
      sessionStorage.setItem(TAB_STORAGE_KEY, created);
      return created;
    } catch {
      // Fall through to in-memory tab id.
    }
  }

  if (!memoryTabId) {
    memoryTabId = generateClientMessageId();
  }

  return memoryTabId;
}

export function resolveRuntimeLocale(configLocale: WidgetLocale | undefined): WidgetLocale {
  return resolveWidgetLocale({
    configLocale,
    browserLanguages: typeof navigator !== "undefined" ? navigator.languages : undefined,
    browserLocale: typeof navigator !== "undefined" ? navigator.language : undefined,
  });
}

export function generateClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** @internal Test-only helper */
export function __resetMemoryStoreForTests(): void {
  memoryStore.clear();
  memoryTabId = null;
}
