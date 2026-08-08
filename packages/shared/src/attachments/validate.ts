import { resolveAttachmentLimits, type AttachmentLimitConfig } from "./limits.js";
import { sanitizeAttachmentFilename } from "./filename.js";
import {
  attachmentKindForMime,
  canonicalizeMimeType,
  detectMimeFromMagicBytes,
  isRejectedAttachmentExtension,
  isRejectedAttachmentMime,
  lookupAttachmentTypeByExtension,
  lookupAttachmentTypeByMime,
  type AttachmentKind,
} from "./mime.js";

export type AttachmentValidationErrorCode =
  | "EMPTY_FILENAME"
  | "REJECTED_TYPE"
  | "UNSUPPORTED_TYPE"
  | "MIME_EXTENSION_MISMATCH"
  | "FILE_TOO_LARGE"
  | "INVALID_SIZE"
  | "MAGIC_BYTE_MISMATCH"
  | "TOO_MANY_FILES";

export type AttachmentValidationError = {
  code: AttachmentValidationErrorCode;
  message: string;
};

export type AttachmentFileDraft = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type ValidatedAttachmentFile = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
};

export function validateAttachmentFileDraft(
  draft: AttachmentFileDraft,
  limits?: Partial<AttachmentLimitConfig>,
): { ok: true; value: ValidatedAttachmentFile } | { ok: false; error: AttachmentValidationError } {
  const resolved = resolveAttachmentLimits(limits);
  const filename = sanitizeAttachmentFilename(draft.filename);

  if (!draft.filename.trim() || !filename) {
    return {
      ok: false,
      error: { code: "EMPTY_FILENAME", message: "Filename is required" },
    };
  }

  if (!Number.isFinite(draft.sizeBytes) || draft.sizeBytes <= 0) {
    return {
      ok: false,
      error: { code: "INVALID_SIZE", message: "File size must be positive" },
    };
  }

  if (isRejectedAttachmentExtension(filename) || isRejectedAttachmentMime(draft.mimeType)) {
    return {
      ok: false,
      error: {
        code: "REJECTED_TYPE",
        message: "Executable or scriptable file types are not allowed",
      },
    };
  }

  const declaredMime = canonicalizeMimeType(draft.mimeType);
  const byMime = lookupAttachmentTypeByMime(declaredMime);
  const byExt = lookupAttachmentTypeByExtension(filename);

  if (!byMime && !byExt) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_TYPE",
        message: "File type is not supported",
      },
    };
  }

  if (byMime && byExt && byMime.kind !== byExt.kind) {
    return {
      ok: false,
      error: {
        code: "MIME_EXTENSION_MISMATCH",
        message: "MIME type does not match file extension",
      },
    };
  }

  // Prefer extension-canonical MIME when both resolve to compatible kinds
  // so clients sending generic application/octet-stream still work via extension.
  let mimeType: string;
  let kind: AttachmentKind;

  if (byExt && byMime) {
    // Allow jpeg/jpg aliasing and zip aliases; otherwise require exact match family
    const mimeExts = new Set(byMime.extensions);
    const ext = filename.includes(".")
      ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
      : "";
    if (!mimeExts.has(ext) && byMime.mimeType !== byExt.mimeType) {
      // zip aliases
      if (!(
        (byMime.mimeType === "application/zip" ||
          byMime.mimeType === "application/x-zip-compressed") &&
        (byExt.mimeType === "application/zip" || byExt.mimeType === "application/x-zip-compressed")
      )) {
        return {
          ok: false,
          error: {
            code: "MIME_EXTENSION_MISMATCH",
            message: "MIME type does not match file extension",
          },
        };
      }
    }
    mimeType = canonicalizeMimeType(byExt.mimeType);
    kind = byExt.kind;
  } else if (byExt) {
    mimeType = canonicalizeMimeType(byExt.mimeType);
    kind = byExt.kind;
  } else if (byMime) {
    mimeType = canonicalizeMimeType(byMime.mimeType);
    kind = byMime.kind;
  } else {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_TYPE",
        message: "File type is not supported",
      },
    };
  }

  const maxBytes = kind === "image" ? resolved.imageMaxBytes : resolved.documentMaxBytes;
  if (draft.sizeBytes > maxBytes) {
    return {
      ok: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: `File exceeds the ${kind} size limit of ${String(maxBytes)} bytes`,
      },
    };
  }

  return {
    ok: true,
    value: {
      filename,
      mimeType,
      sizeBytes: Math.trunc(draft.sizeBytes),
      kind,
    },
  };
}

export function validateAttachmentBatch(
  files: AttachmentFileDraft[],
  limits?: Partial<AttachmentLimitConfig>,
):
  { ok: true; value: ValidatedAttachmentFile[] } | { ok: false; error: AttachmentValidationError } {
  const resolved = resolveAttachmentLimits(limits);
  if (files.length === 0) {
    return {
      ok: false,
      error: { code: "INVALID_SIZE", message: "At least one file is required" },
    };
  }
  if (files.length > resolved.maxFilesPerMessage) {
    return {
      ok: false,
      error: {
        code: "TOO_MANY_FILES",
        message: `At most ${String(resolved.maxFilesPerMessage)} files per message`,
      },
    };
  }

  const values: ValidatedAttachmentFile[] = [];
  for (const file of files) {
    const result = validateAttachmentFileDraft(file, resolved);
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return { ok: true, value: values };
}

/**
 * Server-side confirmation check: declared MIME must match magic bytes.
 */
export function validateMagicBytesAgainstDeclared(input: {
  bytes: Uint8Array;
  declaredMime: string;
  filename: string;
}): { ok: true; detectedMime: string } | { ok: false; error: AttachmentValidationError } {
  const declared = canonicalizeMimeType(input.declaredMime);
  const detected = detectMimeFromMagicBytes(input.bytes, input.filename);

  if (!detected) {
    return {
      ok: false,
      error: {
        code: "MAGIC_BYTE_MISMATCH",
        message: "Could not verify file contents",
      },
    };
  }

  const canonicalDetected = canonicalizeMimeType(detected);
  if (canonicalDetected !== declared) {
    // Allow text/csv vs text/plain confusion only when both are text kinds
    const declaredKind = attachmentKindForMime(declared);
    const detectedKind = attachmentKindForMime(canonicalDetected);
    if (!(
      declaredKind === "document" &&
      detectedKind === "document" &&
      (declared === "text/plain" || declared === "text/csv") &&
      (canonicalDetected === "text/plain" || canonicalDetected === "text/csv")
    )) {
      return {
        ok: false,
        error: {
          code: "MAGIC_BYTE_MISMATCH",
          message: "File contents do not match the declared type",
        },
      };
    }
  }

  return { ok: true, detectedMime: declared };
}
