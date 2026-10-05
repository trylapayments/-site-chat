import "server-only";
import geoip from "geoip-country";

/** Local country database: visitor IP never leaves the application. */
export function countryForStoredIp(
  ip: string | null | undefined,
): string | null {
  if (!ip) return null;
  return geoip.lookup(ip)?.country ?? null;
}
