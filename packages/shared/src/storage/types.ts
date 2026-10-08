/**
 * Abstract object storage port — no vendor lock-in.
 * Supabase Storage is the default adapter; S3-compatible backends can replace it.
 */

export type SignedUploadUrl = {
  url: string;
  token: string | null;
  path: string;
  expiresAt: string;
  headers?: Record<string, string>;
};

export type SignedDownloadUrl = {
  url: string;
  expiresAt: string;
};

export type StoredObjectHead = {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
};

export type CreateSignedUploadOptions = {
  path: string;
  contentType: string;
  upsert?: boolean;
  expiresInSeconds: number;
};

export type CreateSignedDownloadOptions = {
  path: string;
  expiresInSeconds: number;
  downloadFilename?: string;
  /** Override response content type (e.g. force application/octet-stream). */
  contentType?: string;
};

export interface ObjectStorage {
  createSignedUploadUrl(options: CreateSignedUploadOptions): Promise<SignedUploadUrl>;
  createSignedDownloadUrl(options: CreateSignedDownloadOptions): Promise<SignedDownloadUrl>;
  headObject(path: string): Promise<StoredObjectHead | null>;
  downloadRange(path: string, start: number, end: number): Promise<Uint8Array>;
  downloadObject(path: string): Promise<Uint8Array>;
  uploadObject(input: {
    path: string;
    body: Uint8Array | Blob;
    contentType: string;
    upsert?: boolean;
  }): Promise<void>;
  deleteObject(path: string): Promise<void>;
  deleteObjects(paths: string[]): Promise<void>;
}

export const ATTACHMENTS_BUCKET = "attachments" as const;
