const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export function parseParentOriginFromQueryParam(value: string | null): string | null {
  if (value === null || value === "null") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed).trim();
  } catch {
    return null;
  }

  if (!decoded) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    return null;
  }

  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    return null;
  }

  if (url.username || url.password) {
    return null;
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    return null;
  }

  if (url.search && url.search !== "") {
    return null;
  }

  if (url.hash) {
    return null;
  }

  return url.origin;
}

export function readParentOriginFromLocation(location: Pick<Location, "search">): string | null {
  const params = new URLSearchParams(location.search);
  return parseParentOriginFromQueryParam(params.get("parentOrigin"));
}
