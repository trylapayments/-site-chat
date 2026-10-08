export const WIDGET_EMBED_TOKEN_HEADER = "X-SiteChat-Embed-Token";

export const WIDGET_CORS_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  WIDGET_EMBED_TOKEN_HEADER,
].join(", ");

export function getEmbedTokenFromRequest(request: Request): string | null {
  const token = request.headers.get(WIDGET_EMBED_TOKEN_HEADER)?.trim();
  return token && token.length > 0 ? token : null;
}
