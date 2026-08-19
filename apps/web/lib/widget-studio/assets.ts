import "server-only";

import {
  WIDGET_ASSETS_BUCKET,
  WIDGET_ASSET_LIMITS,
  widgetAssetKindSchema,
  type Database,
  type ObjectStorage,
  type WidgetAssetKind,
} from "@site-chat/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { createSupabaseObjectStorage } from "@/lib/storage/supabase-object-storage";
import type { AppSupabaseClient } from "@/lib/supabase/server";

const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
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
  url: string;
  urlExpiresAt: string;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type WidgetAssetTable = Database["public"]["Tables"]["widget_assets"];
type WidgetAssetRow = WidgetAssetTable["Row"];
type WidgetAssetInsert = WidgetAssetTable["Insert"];
type WidgetAssetUpdate = WidgetAssetTable["Update"];
type WidgetAssetDatabase = {
  public: {
    Tables: { widget_assets: WidgetAssetTable };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};
type WidgetAssetClient = SupabaseClient<WidgetAssetDatabase>;

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

function widgetAssetClient(client: AppSupabaseClient): WidgetAssetClient {
  return client as unknown as WidgetAssetClient;
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
      "Use a PNG, JPEG, WebP, or SVG image.",
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

  const hasWidth = input.width !== undefined && input.width !== null;
  const hasHeight = input.height !== undefined && input.height !== null;
  if (hasWidth !== hasHeight) {
    throw new WidgetAssetValidationError(
      "INVALID_DIMENSIONS",
      "Image width and height must be supplied together.",
    );
  }
  if (hasWidth && hasHeight) {
    validateDimensions({
      width: input.width as number,
      height: input.height as number,
    });
  }

  return {
    ...input,
    kind,
    filename,
    mimeType,
  };
}

export async function initiateWidgetAssetUpload(
  input: WidgetAssetUploadInput & {
    workspaceId: string;
    createdBy: string;
    supabase: AppSupabaseClient;
  },
  storage?: ObjectStorage,
): Promise<WidgetAssetUploadIntent> {
  const validated = validateWidgetAssetUpload(input);
  const assetId = randomUUID();
  const storageKey = `workspaces/${input.workspaceId}/widget-assets/${assetId}/${validated.filename}`;
  const objectStorage = storageForAssets(storage);
  const supabase = widgetAssetClient(input.supabase);

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
    // Null dimensions mark an upload as unconfirmed. Public enrichment only
    // signs assets whose dimensions were populated from verified object bytes.
    width: null,
    height: null,
    original_filename: validated.filename,
    created_by: input.createdBy,
  };
  const { error } = await supabase
    .from("widget_assets")
    .insert<WidgetAssetInsert>(row);

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
    supabase: AppSupabaseClient;
  },
  storage?: ObjectStorage,
): Promise<WidgetAssetView> {
  const objectStorage = storageForAssets(storage);
  const supabase = widgetAssetClient(input.supabase);
  const { data: row, error } = await supabase
    .from("widget_assets")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.assetId)
    .maybeSingle<WidgetAssetRow>();

  if (error || !row || row.deleted_at) {
    throw new WidgetAssetValidationError(
      "NOT_FOUND",
      "Asset upload not found.",
    );
  }

  const expiresAt =
    new Date(row.created_at).getTime() +
    WIDGET_ASSET_LIMITS.signedUploadTtlSeconds * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    await rejectUploadedAsset(
      input.supabase,
      row.id,
      row.storage_key,
      objectStorage,
    );
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
    const update: WidgetAssetUpdate = {
      width: dimensions.width,
      height: dimensions.height,
    };
    const { error: updateError } = await supabase
      .from("widget_assets")
      .update<WidgetAssetUpdate>(update)
      .eq("workspace_id", input.workspaceId)
      .eq("id", row.id)
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
      url: signed.url,
      urlExpiresAt: signed.expiresAt,
    };
  } catch (validationError) {
    await rejectUploadedAsset(
      input.supabase,
      row.id,
      row.storage_key,
      objectStorage,
    );
    throw validationError;
  }
}

async function rejectUploadedAsset(
  supabase: AppSupabaseClient,
  assetId: string,
  storageKey: string,
  storage: ObjectStorage,
): Promise<void> {
  const assets = widgetAssetClient(supabase);
  const update: WidgetAssetUpdate = { deleted_at: new Date().toISOString() };
  await Promise.allSettled([
    storage.deleteObject(storageKey),
    assets
      .from("widget_assets")
      .update<WidgetAssetUpdate>(update)
      .eq("id", assetId),
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
  } else if (declaredMime === "image/svg+xml") {
    dimensions = svgDimensions(bytes);
  } else {
    throw contentMismatch();
  }

  if (!dimensions) {
    throw new WidgetAssetValidationError(
      "INVALID_DIMENSIONS",
      "Image dimensions could not be determined.",
    );
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

function svgDimensions(bytes: Uint8Array): ImageDimensions | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw contentMismatch();
  }

  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (
    !/^<\?xml[\s\S]*?\?>\s*<svg\b/i.test(trimmed) &&
    !/^<svg\b/i.test(trimmed)
  ) {
    throw contentMismatch();
  }

  if (
    /<!DOCTYPE/i.test(trimmed) ||
    /<\s*(?:script|style|foreignObject|iframe|object|embed)\b/i.test(trimmed) ||
    /\son[a-z]+\s*=/i.test(trimmed) ||
    /\sstyle\s*=/i.test(trimmed) ||
    /\b(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(trimmed) ||
    /javascript\s*:/i.test(trimmed) ||
    /url\s*\(\s*["']?(?!#)/i.test(trimmed)
  ) {
    throw new WidgetAssetValidationError(
      "UNSAFE_SVG",
      "SVG files cannot contain scripts or external resources.",
    );
  }

  const openingTag = trimmed.match(/<svg\b[^>]*>/i)?.[0];
  if (!openingTag) {
    throw contentMismatch();
  }

  const width = numericSvgAttribute(openingTag, "width");
  const height = numericSvgAttribute(openingTag, "height");
  if (width !== null && height !== null) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const viewBox = openingTag.match(
    /\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i,
  );
  if (viewBox?.[1] && viewBox[2]) {
    return {
      width: Math.round(Number(viewBox[1])),
      height: Math.round(Number(viewBox[2])),
    };
  }
  return null;
}

function numericSvgAttribute(tag: string, attribute: string): number | null {
  const match = tag.match(
    new RegExp(`\\b${attribute}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, "i"),
  );
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
