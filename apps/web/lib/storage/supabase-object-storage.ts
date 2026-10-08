import "server-only";

import type {
  CreateSignedDownloadOptions,
  CreateSignedUploadOptions,
  ObjectStorage,
  SignedDownloadUrl,
  SignedUploadUrl,
  StoredObjectHead,
} from "@site-chat/shared";
import { ATTACHMENTS_BUCKET } from "@site-chat/shared";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Supabase Storage adapter implementing the abstract ObjectStorage port.
 * Swap this for an S3-compatible adapter without changing upload orchestration.
 */
export function createSupabaseObjectStorage(
  bucket: string = ATTACHMENTS_BUCKET,
): ObjectStorage {
  const supabase = createServiceClient();

  return {
    async createSignedUploadUrl(
      options: CreateSignedUploadOptions,
    ): Promise<SignedUploadUrl> {
      // Supabase signed upload tokens are fixed at 2 hours; the SDK does not
      // accept expiresIn. App-level upload intent expiry (attachment_uploads
      // .expires_at) is enforced on complete/cancel and is the real TTL.
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUploadUrl(options.path, {
          upsert: options.upsert ?? false,
        });

      if (error) {
        throw new Error(error.message || "Failed to create signed upload URL");
      }

      const SUPABASE_SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;
      const expiresAt = new Date(
        Date.now() +
          Math.min(
            options.expiresInSeconds,
            SUPABASE_SIGNED_UPLOAD_TTL_SECONDS,
          ) *
            1000,
      ).toISOString();

      return {
        url: data.signedUrl,
        token: data.token,
        path: data.path,
        expiresAt,
        headers: {
          "Content-Type": options.contentType,
        },
      };
    },

    async createSignedDownloadUrl(
      options: CreateSignedDownloadOptions,
    ): Promise<SignedDownloadUrl> {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(options.path, options.expiresInSeconds, {
          download: options.downloadFilename ?? false,
        });

      if (error) {
        throw new Error(
          error.message || "Failed to create signed download URL",
        );
      }

      return {
        url: data.signedUrl,
        expiresAt: new Date(
          Date.now() + options.expiresInSeconds * 1000,
        ).toISOString(),
      };
    },

    async headObject(path: string): Promise<StoredObjectHead | null> {
      const segments = path.split("/");
      const name = segments.pop();
      const folder = segments.join("/");
      if (!name) {
        return null;
      }

      const { data, error } = await supabase.storage.from(bucket).list(folder, {
        search: name,
        limit: 20,
      });

      if (error) {
        return null;
      }

      const match = data.find((item) => item.name === name);
      if (!match) {
        return null;
      }

      const metadata =
        match.metadata && typeof match.metadata === "object"
          ? (match.metadata as Record<string, unknown>)
          : {};
      const sizeValue = metadata.size ?? metadata.contentLength;
      const sizeBytes = typeof sizeValue === "number" ? sizeValue : 0;
      const contentTypeValue = metadata.mimetype ?? metadata.contentType;

      return {
        sizeBytes,
        contentType:
          typeof contentTypeValue === "string" ? contentTypeValue : null,
        etag: typeof metadata.eTag === "string" ? metadata.eTag : null,
      };
    },

    async downloadRange(
      path: string,
      start: number,
      end: number,
    ): Promise<Uint8Array> {
      const bytes = await this.downloadObject(path);
      return bytes.subarray(start, Math.min(end + 1, bytes.length));
    },

    async downloadObject(path: string): Promise<Uint8Array> {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);
      if (error) {
        throw new Error(error.message || "Failed to download object");
      }
      const buffer = await data.arrayBuffer();
      return new Uint8Array(buffer);
    },

    async uploadObject(input: {
      path: string;
      body: Uint8Array | Blob;
      contentType: string;
      upsert?: boolean;
    }): Promise<void> {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(input.path, input.body, {
          contentType: input.contentType,
          upsert: input.upsert ?? false,
        });
      if (error) {
        throw new Error(error.message);
      }
    },

    async deleteObject(path: string): Promise<void> {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) {
        throw new Error(error.message);
      }
    },

    async deleteObjects(paths: string[]): Promise<void> {
      if (paths.length === 0) {
        return;
      }
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        throw new Error(error.message);
      }
    },
  };
}

export async function createSignedImageThumbnailUrl(input: {
  path: string;
  expiresInSeconds: number;
  width?: number;
  height?: number;
}): Promise<SignedDownloadUrl> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(input.path, input.expiresInSeconds, {
      transform: {
        width: input.width ?? 480,
        height: input.height ?? 480,
        resize: "contain",
        quality: 75,
      },
    });

  if (error) {
    return createSupabaseObjectStorage().createSignedDownloadUrl({
      path: input.path,
      expiresInSeconds: input.expiresInSeconds,
    });
  }

  return {
    url: data.signedUrl,
    expiresAt: new Date(
      Date.now() + input.expiresInSeconds * 1000,
    ).toISOString(),
  };
}
