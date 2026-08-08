/**
 * Extensible MIME / extension allowlist for chat attachments.
 * Executable and scriptable types are explicitly rejected.
 */

export type AttachmentKind = "image" | "document";

export type AllowedAttachmentType = {
  mimeType: string;
  extensions: readonly string[];
  kind: AttachmentKind;
  /** Human label for UI icons / a11y. */
  label: string;
};

/** Ordered registry — first match wins for extension → MIME resolution. */
export const ALLOWED_ATTACHMENT_TYPES: readonly AllowedAttachmentType[] = [
  {
    mimeType: "image/jpeg",
    extensions: ["jpg", "jpeg"],
    kind: "image",
    label: "JPEG",
  },
  {
    mimeType: "image/png",
    extensions: ["png"],
    kind: "image",
    label: "PNG",
  },
  {
    mimeType: "image/gif",
    extensions: ["gif"],
    kind: "image",
    label: "GIF",
  },
  {
    mimeType: "image/webp",
    extensions: ["webp"],
    kind: "image",
    label: "WebP",
  },
  {
    mimeType: "application/pdf",
    extensions: ["pdf"],
    kind: "document",
    label: "PDF",
  },
  {
    mimeType: "application/msword",
    extensions: ["doc"],
    kind: "document",
    label: "Word",
  },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
    kind: "document",
    label: "Word",
  },
  {
    mimeType: "application/vnd.ms-excel",
    extensions: ["xls"],
    kind: "document",
    label: "Excel",
  },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
    kind: "document",
    label: "Excel",
  },
  {
    mimeType: "application/vnd.ms-powerpoint",
    extensions: ["ppt"],
    kind: "document",
    label: "PowerPoint",
  },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: ["pptx"],
    kind: "document",
    label: "PowerPoint",
  },
  {
    mimeType: "text/plain",
    extensions: ["txt"],
    kind: "document",
    label: "Text",
  },
  {
    mimeType: "text/csv",
    extensions: ["csv"],
    kind: "document",
    label: "CSV",
  },
  {
    mimeType: "application/zip",
    extensions: ["zip"],
    kind: "document",
    label: "ZIP",
  },
  {
    mimeType: "application/x-zip-compressed",
    extensions: ["zip"],
    kind: "document",
    label: "ZIP",
  },
] as const;

/** MIME types that must never be accepted (XSS / execution risk). */
export const REJECTED_ATTACHMENT_MIME_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-sh",
  "application/x-csh",
  "application/x-bat",
  "application/x-msi",
  "application/wasm",
]);

export const REJECTED_ATTACHMENT_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "scr",
  "msi",
  "msp",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "html",
  "htm",
  "shtml",
  "svg",
  "svgz",
  "php",
  "phtml",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "pl",
  "py",
  "rb",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "jar",
  "apk",
  "dmg",
  "pkg",
  "deb",
  "rpm",
]);

const MIME_INDEX = new Map(
  ALLOWED_ATTACHMENT_TYPES.map((entry) => [entry.mimeType.toLowerCase(), entry]),
);

const EXTENSION_INDEX = new Map<string, AllowedAttachmentType>();
for (const entry of ALLOWED_ATTACHMENT_TYPES) {
  for (const ext of entry.extensions) {
    if (!EXTENSION_INDEX.has(ext)) {
      EXTENSION_INDEX.set(ext, entry);
    }
  }
}

export function normalizeExtension(filename: string): string | null {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
}

export function lookupAttachmentTypeByMime(mimeType: string): AllowedAttachmentType | null {
  return MIME_INDEX.get(mimeType.trim().toLowerCase()) ?? null;
}

export function lookupAttachmentTypeByExtension(filename: string): AllowedAttachmentType | null {
  const ext = normalizeExtension(filename);
  if (!ext) {
    return null;
  }
  if (REJECTED_ATTACHMENT_EXTENSIONS.has(ext)) {
    return null;
  }
  return EXTENSION_INDEX.get(ext) ?? null;
}

export function isRejectedAttachmentMime(mimeType: string): boolean {
  return REJECTED_ATTACHMENT_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function isRejectedAttachmentExtension(filename: string): boolean {
  const ext = normalizeExtension(filename);
  return ext !== null && REJECTED_ATTACHMENT_EXTENSIONS.has(ext);
}

export function attachmentKindForMime(mimeType: string): AttachmentKind | null {
  return lookupAttachmentTypeByMime(mimeType)?.kind ?? null;
}

/**
 * Detect MIME from magic bytes. Returns null when inconclusive.
 * Office Open XML formats share ZIP magic; caller should refine with extension.
 */
export function detectMimeFromMagicBytes(bytes: Uint8Array, filenameHint?: string): string | null {
  if (bytes.length < 4) {
    return null;
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }

  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  // PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }

  // OLE Compound Document (legacy .doc / .xls / .ppt)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    const byExt = filenameHint ? lookupAttachmentTypeByExtension(filenameHint) : null;
    if (
      byExt &&
      (byExt.mimeType === "application/msword" ||
        byExt.mimeType === "application/vnd.ms-excel" ||
        byExt.mimeType === "application/vnd.ms-powerpoint")
    ) {
      return byExt.mimeType;
    }
    return null;
  }

  // ZIP / OOXML
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  ) {
    const byExt = filenameHint ? lookupAttachmentTypeByExtension(filenameHint) : null;
    if (byExt) {
      if (
        byExt.mimeType.startsWith("application/vnd.openxmlformats-officedocument.") ||
        byExt.mimeType === "application/zip" ||
        byExt.mimeType === "application/x-zip-compressed"
      ) {
        return byExt.mimeType === "application/x-zip-compressed"
          ? "application/zip"
          : byExt.mimeType;
      }
    }
    return "application/zip";
  }

  // Text/CSV — only when extension claims text and content looks textual
  if (filenameHint) {
    const byExt = lookupAttachmentTypeByExtension(filenameHint);
    if (byExt && (byExt.mimeType === "text/plain" || byExt.mimeType === "text/csv")) {
      if (looksLikeText(bytes)) {
        return byExt.mimeType;
      }
      return null;
    }
  }

  return null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i];
    if (b === undefined) {
      continue;
    }
    if (b === 0) {
      return false;
    }
    // Allow common whitespace + printable ASCII / high UTF-8 bytes
    if (b < 0x09 || (b > 0x0d && b < 0x20)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length < 0.1;
}

/**
 * Canonical MIME used for storage metadata (collapse zip aliases).
 */
export function canonicalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "application/x-zip-compressed") {
    return "application/zip";
  }
  return normalized;
}
