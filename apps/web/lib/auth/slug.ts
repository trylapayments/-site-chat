const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 63;
const MIN_SLUG_LENGTH = 3;

/**
 * Generates a URL-safe workspace slug from a display name.
 */
export function generateSlugFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    return "";
  }

  if (normalized.length <= MAX_SLUG_LENGTH) {
    return normalized;
  }

  const truncated = normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return truncated;
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= MIN_SLUG_LENGTH &&
    slug.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(slug)
  );
}

export { SLUG_PATTERN, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH };
