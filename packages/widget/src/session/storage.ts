import type { WidgetLocale } from "../i18n";

const STORAGE_PREFIX = "sitechat:session:";

export function getSessionStorageKey(widgetPublicKey: string): string {
  return `${STORAGE_PREFIX}${widgetPublicKey}`;
}

export function readSessionToken(widgetPublicKey: string): string | null {
  try {
    return localStorage.getItem(getSessionStorageKey(widgetPublicKey));
  } catch {
    return null;
  }
}

export function writeSessionToken(widgetPublicKey: string, token: string): boolean {
  try {
    localStorage.setItem(getSessionStorageKey(widgetPublicKey), token);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionToken(widgetPublicKey: string): void {
  try {
    localStorage.removeItem(getSessionStorageKey(widgetPublicKey));
  } catch {
    // Storage unavailable — ignore.
  }
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
  if (configLocale === "en" || configLocale === "ru") {
    return configLocale;
  }

  const browser = navigator.language.toLowerCase();
  return browser.startsWith("ru") ? "ru" : "en";
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
