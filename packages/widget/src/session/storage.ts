import { isVisitorPublicId, resolveWidgetLocale, type WidgetLocale } from "@site-chat/shared";

const STORAGE_PREFIX = "sitechat:session:";
const VISITOR_STORAGE_PREFIX = "sitechat:visitor:";
const memoryStore = new Map<string, string>();

export function getSessionStorageKey(widgetPublicKey: string): string {
  return `${STORAGE_PREFIX}${widgetPublicKey}`;
}

export function getVisitorStorageKey(widgetPublicKey: string): string {
  return `${VISITOR_STORAGE_PREFIX}${widgetPublicKey}`;
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
}
