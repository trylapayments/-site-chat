/** Vercel overwrites this edge header from the connecting IP. Do not accept
 * client-provided country values on other hosts or derive them from locale. */
export function ipCountryFromRequest(request: Request): string | null {
  if (process.env.VERCEL !== "1") return null;
  const code = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null;
}
