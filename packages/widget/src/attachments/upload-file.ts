import { validateAttachmentFileDraft, type AttachmentKind } from "@site-chat/shared";

export type SelectedLocalFile = {
  localId: string;
  file: File;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
};

let localIdCounter = 0;

export function nextLocalFileId(): string {
  localIdCounter += 1;
  return `local-${String(Date.now())}-${String(localIdCounter)}`;
}

export async function fileToSelectedLocalFile(
  file: File,
): Promise<{ ok: true; value: SelectedLocalFile } | { ok: false; message: string }> {
  const validated = validateAttachmentFileDraft({
    filename: file.name || "file",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });

  if (!validated.ok) {
    return { ok: false, message: validated.error.message };
  }

  let previewUrl: string | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (validated.value.kind === "image") {
    previewUrl = URL.createObjectURL(file);
    const dimensions = await readImageDimensions(previewUrl);
    width = dimensions?.width ?? null;
    height = dimensions?.height ?? null;
  }

  return {
    ok: true,
    value: {
      localId: nextLocalFileId(),
      file,
      filename: validated.value.filename,
      mimeType: validated.value.mimeType,
      sizeBytes: validated.value.sizeBytes,
      kind: validated.value.kind,
      previewUrl,
      width,
      height,
    },
  };
}

function readImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = url;
  });
}

export function revokePreviewUrls(files: SelectedLocalFile[]): void {
  for (const file of files) {
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
}

export function acceptAttributeForAttachments(): string {
  return [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".csv",
    ".zip",
    "image/*",
  ].join(",");
}

/**
 * Upload a file to a signed URL with progress via XHR (no base64).
 * Returns an abort function through the AbortSignal.
 */
export function uploadBlobWithProgress(input: {
  url: string;
  token?: string | null;
  file: Blob;
  contentType: string;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Prefer the signed URL as returned (includes ?token=). Do not send the
    // storage upload token as Authorization Bearer — that confuses GoTrue auth
    // and is unnecessary when the token is already a query param.
    const uploadUrl = (() => {
      if (!input.token) {
        return input.url;
      }
      try {
        const parsed = new URL(input.url);
        if (!parsed.searchParams.get("token")) {
          parsed.searchParams.set("token", input.token);
        }
        return parsed.toString();
      } catch {
        return input.url;
      }
    })();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", input.contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.round((event.loaded / event.total) * 100);
      input.onProgress(percent);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress(100);
        resolve();
        return;
      }
      reject(new Error(`Upload failed (${String(xhr.status)})`));
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };
    xhr.onabort = () => {
      reject(new Error("Upload cancelled"));
    };

    if (input.signal) {
      if (input.signal.aborted) {
        xhr.abort();
        return;
      }
      input.signal.addEventListener(
        "abort",
        () => {
          xhr.abort();
        },
        { once: true },
      );
    }

    xhr.send(input.file);
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentIconLabel(mimeType: string): string {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("word") || mimeType.includes("msword")) return "DOC";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "XLS";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "PPT";
  if (mimeType.includes("zip")) return "ZIP";
  if (mimeType.includes("csv")) return "CSV";
  if (mimeType.startsWith("text/")) return "TXT";
  return "FILE";
}
