/** Vercel overwrites this edge header from the connecting IP. Do not accept
 * client-provided country values on other hosts or derive them from locale. */
export function ipCountryFromRequest(request: Request): string | null {
  if (process.env.VERCEL !== "1") return null;
  const code = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null;
}

/** Trusted edge geolocation only; never accept a browser-supplied location. */
export function ipCityFromRequest(request: Request): string | null {
  if (process.env.VERCEL !== "1") return null;
  const raw = request.headers.get("x-vercel-ip-city");
  if (!raw) return null;
  try {
    const city = decodeURIComponent(raw).trim();
    return city &&
      city.length <= 128 &&
      !Array.from(city).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
      ? city
      : null;
  } catch {
    return null;
  }
}
