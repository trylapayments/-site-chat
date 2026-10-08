import { DEVICE_TYPES, type DeviceType } from "./constants";
import { stripControlChars } from "./identity";

export type UserAgentMetadata = {
  browserFamily: string | null;
  browserVersion: string | null;
  osFamily: string | null;
  deviceType: DeviceType;
};

/**
 * Lightweight user-agent parsing for operator context.
 *
 * Limitations (intentional):
 * - Not a full UA database; family/version heuristics only
 * - Client UA strings are spoofable
 * - Does not fingerprint; stores coarse categories only
 * - Prefer Client Hints in a future PR when available server-side
 */
export function parseUserAgent(raw: unknown): UserAgentMetadata {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      browserFamily: null,
      browserVersion: null,
      osFamily: null,
      deviceType: "unknown",
    };
  }

  const ua = stripControlChars(raw).slice(0, 512);
  const lower = ua.toLowerCase();

  const deviceType = detectDeviceType(lower);
  const osFamily = detectOs(lower);
  const browser = detectBrowser(ua, lower);

  return {
    browserFamily: browser.family,
    browserVersion: browser.version,
    osFamily,
    deviceType,
  };
}

function detectDeviceType(lower: string): DeviceType {
  if (
    /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|linkedinbot|bot\b|crawler|spider/i.test(
      lower,
    )
  ) {
    return "bot";
  }
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(lower)) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(lower)) {
    return "mobile";
  }
  if (/windows|macintosh|linux|cros|x11/i.test(lower)) {
    return "desktop";
  }
  return "unknown";
}

function detectOs(lower: string): string | null {
  if (lower.includes("android")) return "Android";
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ipod")) {
    return "iOS";
  }
  if (lower.includes("windows")) return "Windows";
  if (lower.includes("mac os") || lower.includes("macintosh")) return "macOS";
  if (lower.includes("cros")) return "Chrome OS";
  if (lower.includes("linux")) return "Linux";
  return null;
}

function detectBrowser(
  ua: string,
  lower: string,
): { family: string | null; version: string | null } {
  // Order matters: Edge/Opera/Samsung before Chrome; Chrome before Safari.
  const matchers: Array<{ family: string; pattern: RegExp }> = [
    { family: "Edge", pattern: /Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)?)/ },
    { family: "Opera", pattern: /(?:OPR|Opera)\/(\d+(?:\.\d+)?)/ },
    { family: "Samsung Internet", pattern: /SamsungBrowser\/(\d+(?:\.\d+)?)/ },
    { family: "Firefox", pattern: /Firefox\/(\d+(?:\.\d+)?)/ },
    { family: "Chrome", pattern: /(?:Chrome|CriOS)\/(\d+(?:\.\d+)?)/ },
    { family: "Safari", pattern: /Version\/(\d+(?:\.\d+)?).*Safari/ },
  ];

  for (const matcher of matchers) {
    if (matcher.family === "Chrome" && /edg|opr|samsungbrowser/i.test(lower)) {
      continue;
    }
    if (matcher.family === "Safari" && /chrome|chromium|crios|android/i.test(lower)) {
      continue;
    }
    const match = ua.match(matcher.pattern);
    if (match) {
      return { family: matcher.family, version: match[1] ?? null };
    }
  }

  return { family: null, version: null };
}

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === "string" && (DEVICE_TYPES as readonly string[]).includes(value);
}
