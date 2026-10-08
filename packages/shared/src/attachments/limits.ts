/**
 * Configurable attachment size limits.
 * Defaults match product requirements; plan overrides can replace these later.
 */

export const ATTACHMENT_LIMITS = {
  /** Max files per message / upload batch. */
  maxFilesPerMessage: 10,
  /** Image max size (bytes). */
  imageMaxBytes: 20 * 1024 * 1024,
  /** Document max size (bytes). */
  documentMaxBytes: 50 * 1024 * 1024,
  /** Signed upload URL TTL. */
  signedUploadTtlSeconds: 10 * 60,
  /** Signed download URL TTL. */
  signedDownloadTtlSeconds: 15 * 60,
  /** Pending upload intent TTL before expiry cleanup. */
  uploadIntentTtlSeconds: 30 * 60,
  /** Max original filename length (after sanitization). */
  maxFilenameLength: 255,
} as const;

export type AttachmentLimitConfig = {
  imageMaxBytes: number;
  documentMaxBytes: number;
  maxFilesPerMessage: number;
};

export function resolveAttachmentLimits(
  overrides?: Partial<AttachmentLimitConfig>,
): AttachmentLimitConfig {
  return {
    imageMaxBytes: overrides?.imageMaxBytes ?? ATTACHMENT_LIMITS.imageMaxBytes,
    documentMaxBytes: overrides?.documentMaxBytes ?? ATTACHMENT_LIMITS.documentMaxBytes,
    maxFilesPerMessage: overrides?.maxFilesPerMessage ?? ATTACHMENT_LIMITS.maxFilesPerMessage,
  };
}
