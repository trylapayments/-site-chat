import "server-only";

import {
  WIDGET_ASSETS_BUCKET,
  WIDGET_ASSET_LIMITS,
  isWidgetAssetStorageKeyForWorkspace,
  widgetAssetKindSchema,
  widgetAssetStorageKeyPrefix,
  type Database,
  type ObjectStorage,
  type WidgetAssetKind,
  type WidgetAssetStatus,
} from "@site-chat/shared";
import { randomUUID } from "node:crypto";

import { createSupabaseObjectStorage } from "@/lib/storage/supabase-object-storage";
import { createServiceClient } from "@/lib/supabase/service";

const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
};

export type WidgetAssetUploadInput = {
  kind: WidgetAssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
};

export type WidgetAssetUploadIntent = {
  assetId: string;
  kind: WidgetAssetKind;
  filename: string;
  uploadUrl: string;
  uploadToken: string | null;
  expiresAt: string;
  headers: Record<string, string>;
};

export type WidgetAssetView = {
  id: string;
  kind: WidgetAssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: WidgetAssetStatus;
  url: string;
  urlExpiresAt: string;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type WidgetAssetTable = Database["public"]["Tables"]["widget_assets"];
type WidgetAssetInsert = WidgetAssetTable["Insert"];
type WidgetAssetUpdate = WidgetAssetTable["Update"];

export class WidgetAssetValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WidgetAssetValidationError";
    this.code = code;
  }
}

function storageForAssets(storage?: ObjectStorage): ObjectStorage {
  return storage ?? createSupabaseObjectStorage(WIDGET_ASSETS_BUCKET);
}

/** Service-role client only — authenticated JWT cannot mutate widget_assets. */
function serviceAssetClient(): ReturnType<typeof createServiceClient> {
  return createServiceClient();
}

export function buildWidgetAssetStorageKey(input: {
  workspaceId: string;
  assetId: string;
  filename: string;
}): string {
  const key = `${widgetAssetStorageKeyPrefix(input.workspaceId)}${input.assetId}/${input.filename}`;
  if (!isWidgetAssetStorageKeyForWorkspace(key, input.workspaceId)) {
    throw new WidgetAssetValidationError(
      "INVALID_STORAGE_KEY",
      "Generated storage key failed workspace prefix validation.",
    );
  }
  return key;
}

export function sanitizeWidgetAssetFilename(raw: string): string {
  let name = raw.normalize("NFC").replace(/\\/g, "/").split("/").pop() ?? "";
  // eslint-disable-next-line no-control-regex -- strips control characters from an untrusted filename
  name = name.replace(/[\u0000-\u001f\u007f]/g, "");
  name = name
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (!name || name === "." || name === "..") {
    throw new WidgetAssetValidationError(
      "INVALID_FILENAME",
      "A valid filename is required.",
    );
  }

  if (name.length > WIDGET_ASSET_LIMITS.maxFilenameLength) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot) : "";
    const base = dot > 0 ? name.slice(0, dot) : name;
    name = `${base.slice(
      0,
      Math.max(1, WIDGET_ASSET_LIMITS.maxFilenameLength - extension.length),
    )}${extension}`;
  }

  return name.replace(/\//g, "_");
}

export function validateWidgetAssetUpload(
  input: WidgetAssetUploadInput,
): WidgetAssetUploadInput & { filename: string; mimeType: string } {
  const kind = widgetAssetKindSchema.parse(input.kind);
  const filename = sanitizeWidgetAssetFilename(input.filename);
  const mimeType = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (
    !(WIDGET_ASSET_LIMITS.allowedMimeTypes as readonly string[]).includes(
      mimeType,
    )
  ) {
    throw new WidgetAssetValidationError(
      "UNSUPPORTED_TYPE",
      "Use a PNG, JPEG, or WebP image.",
    );
  }

  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (!MIME_EXTENSIONS[mimeType]?.includes(extension)) {
    throw new WidgetAssetValidationError(
      "MIME_EXTENSION_MISMATCH",
      "The filename extension does not match the image type.",
    );
  }

  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > WIDGET_ASSET_LIMITS.maxBytes
  ) {
    throw new WidgetAssetValidationError(
      "INVALID_SIZE",
      `Image size must be between 1 and ${String(
        WIDGET_ASSET_LIMITS.maxBytes,
      )} bytes.`,
    );
  }

  // Client-supplied dimensions are ignored for trust. Server verifies bytes.
  return {
    kind,
    filename,
    mimeType,
    sizeBytes: input.sizeBytes,
    width: null,
    height: null,
  };
}

/**
 * Create a pending asset row + signed upload URL.
 * Mutates only via service role after the caller has enforced manage_widget_studio.
 */
export async function initiateWidgetAssetUpload(
  input: WidgetAssetUploadInput & {
    workspaceId: string;
    createdBy: string;
  },
  storage?: ObjectStorage,
): Promise<WidgetAssetUploadIntent> {
  const validated = validateWidgetAssetUpload(input);
  const assetId = randomUUID();
  const storageKey = buildWidgetAssetStorageKey({
    workspaceId: input.workspaceId,
    assetId,
    filename: validated.filename,
  });
  const objectStorage = storageForAssets(storage);
  const supabase = serviceAssetClient();

  const signed = await objectStorage.createSignedUploadUrl({
    path: storageKey,
    contentType: validated.mimeType,
    expiresInSeconds: WIDGET_ASSET_LIMITS.signedUploadTtlSeconds,
    upsert: false,
  });

  const row: WidgetAssetInsert = {
    id: assetId,
    workspace_id: input.workspaceId,
    kind: validated.kind,
    storage_key: storageKey,
    mime_type: validated.mimeType,
    byte_size: validated.sizeBytes,
    width: null,
    height: null,
    status: "pending",
    verified_at: null,
    original_filename: validated.filename,
    created_by: input.createdBy,
  };
  const { error } = await supabase.from("widget_assets").insert(row);

  if (error) {
    throw new Error("Unable to create the asset upload.");
  }

  return {
    assetId,
    kind: validated.kind,
    filename: validated.filename,
    uploadUrl: signed.url,
    uploadToken: signed.token ?? null,
    expiresAt: signed.expiresAt,
    headers: signed.headers ?? {},
  };
}

export async function completeWidgetAssetUpload(
  input: {
    workspaceId: string;
    assetId: string;
  },
  storage?: ObjectStorage,
): Promise<WidgetAssetView> {
  const objectStorage = storageForAssets(storage);
  const supabase = serviceAssetClient();
  const { data: row, error } = await supabase
    .from("widget_assets")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.assetId)
    .maybeSingle();

  if (error || !row || row.deleted_at) {
    throw new WidgetAssetValidationError(
      "NOT_FOUND",
      "Asset upload not found.",
    );
  }

  if (row.status === "verified" && row.verified_at) {
    if (
      !isWidgetAssetStorageKeyForWorkspace(row.storage_key, input.workspaceId)
    ) {
      throw new WidgetAssetValidationError(
        "INVALID_STORAGE_KEY",
        "Asset storage key is not scoped to this workspace.",
      );
    }
    const signed = await objectStorage.createSignedDownloadUrl({
      path: row.storage_key,
      expiresInSeconds: WIDGET_ASSET_LIMITS.signedDownloadTtlSeconds,
    });
    return {
      id: row.id,
      kind: widgetAssetKindSchema.parse(row.kind),
      filename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.byte_size,
      width: row.width,
      height: row.height,
      status: "verified",
      url: signed.url,
      urlExpiresAt: signed.expiresAt,
    };
  }

  if (
    !isWidgetAssetStorageKeyForWorkspace(row.storage_key, input.workspaceId)
  ) {
    await rejectUploadedAsset(row.id, row.storage_key, objectStorage);
    throw new WidgetAssetValidationError(
      "INVALID_STORAGE_KEY",
      "Asset storage key is not scoped to this workspace.",
    );
  }

  const expiresAt =
    new Date(row.created_at).getTime() +
    WIDGET_ASSET_LIMITS.signedUploadTtlSeconds * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    await rejectUploadedAsset(row.id, row.storage_key, objectStorage);
    throw new WidgetAssetValidationError(
      "UPLOAD_EXPIRED",
      "The asset upload expired. Choose the file again.",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await objectStorage.downloadObject(row.storage_key);
  } catch {
    throw new WidgetAssetValidationError(
      "UPLOAD_MISSING",
      "The uploaded image was not found.",
    );
  }

  try {
    if (
      bytes.length !== row.byte_size ||
      bytes.length <= 0 ||
      bytes.length > WIDGET_ASSET_LIMITS.maxBytes
    ) {
      throw new WidgetAssetValidationError(
        "SIZE_MISMATCH",
        "The uploaded image size does not match the request.",
      );
    }

    const dimensions = validateWidgetAssetContents(bytes, row.mime_type);
    const nowIso = new Date().toISOString();
    const update: WidgetAssetUpdate = {
      width: dimensions.width,
      height: dimensions.height,
      status: "verified",
      verified_at: nowIso,
    };
    const { error: updateError } = await supabase
      .from("widget_assets")
      .update(update)
      .eq("workspace_id", input.workspaceId)
      .eq("id", row.id)
      .eq("status", "pending")
      .is("deleted_at", null);

    if (updateError) {
      throw new Error("Unable to confirm the asset upload.");
    }

    const signed = await objectStorage.createSignedDownloadUrl({
      path: row.storage_key,
      expiresInSeconds: WIDGET_ASSET_LIMITS.signedDownloadTtlSeconds,
    });

    return {
      id: row.id,
      kind: widgetAssetKindSchema.parse(row.kind),
      filename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.byte_size,
      width: dimensions.width,
      height: dimensions.height,
      status: "verified",
      url: signed.url,
      urlExpiresAt: signed.expiresAt,
    };
  } catch (validationError) {
    await rejectUploadedAsset(row.id, row.storage_key, objectStorage);
    throw validationError;
  }
}

async function rejectUploadedAsset(
  assetId: string,
  storageKey: string,
  storage: ObjectStorage,
): Promise<void> {
  const assets = serviceAssetClient();
  const update: WidgetAssetUpdate = {
    deleted_at: new Date().toISOString(),
    status: "rejected",
    verified_at: null,
    width: null,
    height: null,
  };
  await Promise.allSettled([
    storage.deleteObject(storageKey),
    assets.from("widget_assets").update(update).eq("id", assetId),
  ]);
}

export function validateWidgetAssetContents(
  bytes: Uint8Array,
  declaredMime: string,
): ImageDimensions {
  let dimensions: ImageDimensions | null = null;

  if (declaredMime === "image/png") {
    if (
      bytes.length < 24 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47 ||
      bytes[12] !== 0x49 ||
      bytes[13] !== 0x48 ||
      bytes[14] !== 0x44 ||
      bytes[15] !== 0x52
    ) {
      throw contentMismatch();
    }
    dimensions = {
      width: readUint32BigEndian(bytes, 16),
      height: readUint32BigEndian(bytes, 20),
    };
  } else if (declaredMime === "image/jpeg") {
    dimensions = jpegDimensions(bytes);
    if (!dimensions) {
      throw contentMismatch();
    }
  } else if (declaredMime === "image/webp") {
    dimensions = webpDimensions(bytes);
    if (!dimensions) {
      throw contentMismatch();
    }
  } else {
    throw contentMismatch();
  }

  validateDimensions(dimensions);
  return dimensions;
}

function contentMismatch(): WidgetAssetValidationError {
  return new WidgetAssetValidationError(
    "CONTENT_MISMATCH",
    "The uploaded file does not match the declared image type.",
  );
}

function validateDimensions(dimensions: ImageDimensions): void {
  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width < WIDGET_ASSET_LIMITS.minWidth ||
    dimensions.height < WIDGET_ASSET_LIMITS.minHeight ||
    dimensions.width > WIDGET_ASSET_LIMITS.maxWidth ||
    dimensions.height > WIDGET_ASSET_LIMITS.maxHeight
  ) {
    throw new WidgetAssetValidationError(
      "INVALID_DIMENSIONS",
      `Image dimensions must be between ${String(
        WIDGET_ASSET_LIMITS.minWidth,
      )} and ${String(WIDGET_ASSET_LIMITS.maxWidth)} pixels.`,
    );
  }
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (bytes[offset + 1] ?? 0) * 0x10000 +
    (bytes[offset + 2] ?? 0) * 0x100 +
    (bytes[offset + 3] ?? 0)
  );
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x100 +
    (bytes[offset + 2] ?? 0) * 0x10000
  );
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null;
  }

  let offset = 2;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) {
      return null;
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength =
      (bytes[offset + 2] ?? 0) * 0x100 + (bytes[offset + 3] ?? 0);
    if (segmentLength < 2 || offset + segmentLength + 2 > bytes.length) {
      return null;
    }
    if (startOfFrameMarkers.has(marker)) {
      return {
        height: (bytes[offset + 5] ?? 0) * 0x100 + (bytes[offset + 6] ?? 0),
        width: (bytes[offset + 7] ?? 0) * 0x100 + (bytes[offset + 8] ?? 0),
      };
    }
    offset += segmentLength + 2;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null;
  }

  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    return {
      width: 1 + (bytes[21] ?? 0) + (((bytes[22] ?? 0) & 0x3f) << 8),
      height:
        1 +
        (((bytes[22] ?? 0) & 0xc0) >> 6) +
        ((bytes[23] ?? 0) << 2) +
        (((bytes[24] ?? 0) & 0x0f) << 10),
    };
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: ((bytes[26] ?? 0) + ((bytes[27] ?? 0) << 8)) & 0x3fff,
      height: ((bytes[28] ?? 0) + ((bytes[29] ?? 0) << 8)) & 0x3fff,
    };
  }
  return null;
}
