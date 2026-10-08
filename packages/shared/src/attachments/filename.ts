import { ATTACHMENT_LIMITS } from "./limits.js";
import { normalizeExtension } from "./mime.js";

/**
 * Sanitize user-provided filenames for safe storage metadata and Content-Disposition.
 * Never trust the original name for filesystem paths — storage keys are UUID-based.
 */
export function sanitizeAttachmentFilename(raw: string): string {
  let name = raw.normalize("NFC");

  // Strip path components
  name = name.replace(/\\/g, "/");
  const parts = name.split("/");
  name = parts[parts.length - 1] ?? "";

  // Remove nulls / control chars (eslint: intentional control-char strip)
  // eslint-disable-next-line no-control-regex -- sanitize untrusted filenames
  name = name.replace(/[\u0000-\u001f\u007f]/g, "");

  // Neutralize HTML / script-looking sequences in the display name
  name = name.replace(/[<>:"|?*]/g, "_");

  // Collapse whitespace
  name = name.replace(/\s+/g, " ").trim();

  // Reject hidden / relative names
  if (!name || name === "." || name === "..") {
    name = "file";
  }

  // Prevent double extensions that end in dangerous suffixes (e.g. report.pdf.exe)
  // by keeping only the final extension for length budgeting.
  if (name.length > ATTACHMENT_LIMITS.maxFilenameLength) {
    const ext = normalizeExtension(name);
    const maxBase = ATTACHMENT_LIMITS.maxFilenameLength - (ext ? ext.length + 1 : 0);
    const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
    const truncated = base.slice(0, Math.max(1, maxBase));
    name = ext ? `${truncated}.${ext}` : truncated;
  }

  return name;
}

/**
 * RFC 5987 Content-Disposition filename* value (UTF-8).
 * Always pair with a conservative ASCII filename fallback.
 */
export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeAttachmentFilename(filename);
  const asciiFallback =
    safe
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "file";
  const encoded = encodeURIComponent(safe).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Build a workspace-scoped storage key. Never embeds the raw filename as a path segment
 * that could traverse — filename is only the final display segment after sanitization.
 */
export function buildAttachmentStorageKey(input: {
  workspaceId: string;
  conversationId: string;
  attachmentId: string;
  filename: string;
}): string {
  const safeName = sanitizeAttachmentFilename(input.filename).replace(/\//g, "_");
  return `${input.workspaceId}/${input.conversationId}/${input.attachmentId}/${safeName}`;
}

export function buildThumbnailStorageKey(storageKey: string): string {
  return `${storageKey}.thumb.webp`;
}
