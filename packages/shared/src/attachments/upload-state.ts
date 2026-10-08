/**
 * Client upload state machine for attachment batches.
 * Pure transitions — no I/O. UI and transport layers drive events.
 */

export type UploadItemStatus =
  "queued" | "uploading" | "uploaded" | "confirming" | "complete" | "failed" | "cancelled";

export type UploadBatchStatus =
  "idle" | "preparing" | "uploading" | "confirming" | "complete" | "failed" | "cancelled";

export type UploadItemState = {
  localId: string;
  uploadId: string | null;
  attachmentId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "document";
  status: UploadItemStatus;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  order: number;
};

export type UploadBatchState = {
  batchId: string | null;
  status: UploadBatchStatus;
  items: UploadItemState[];
  clientMessageId: string | null;
  body: string;
  errorMessage: string | null;
};

export type UploadStateEvent =
  | {
      type: "SELECT_FILES";
      items: Array<{
        localId: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        kind: "image" | "document";
        previewUrl?: string | null;
        width?: number | null;
        height?: number | null;
      }>;
      body?: string;
      clientMessageId?: string;
    }
  | {
      type: "PREPARE_SUCCESS";
      batchId: string;
      uploads: Array<{ localId: string; uploadId: string; attachmentId: string }>;
    }
  | { type: "PREPARE_FAILURE"; message: string; code?: string }
  | { type: "UPLOAD_PROGRESS"; localId: string; progress: number }
  | { type: "UPLOAD_ITEM_SUCCESS"; localId: string }
  | { type: "UPLOAD_ITEM_FAILURE"; localId: string; message: string; code?: string }
  | { type: "CONFIRM_START" }
  | { type: "CONFIRM_SUCCESS" }
  | { type: "CONFIRM_FAILURE"; message: string; code?: string }
  | { type: "CANCEL"; localId?: string }
  | { type: "RETRY" }
  | { type: "RESET" };

export function createEmptyUploadBatch(body = ""): UploadBatchState {
  return {
    batchId: null,
    status: "idle",
    items: [],
    clientMessageId: null,
    body,
    errorMessage: null,
  };
}

function setItems(
  state: UploadBatchState,
  updater: (item: UploadItemState) => UploadItemState,
): UploadBatchState {
  return { ...state, items: state.items.map(updater) };
}

function deriveBatchStatus(items: UploadItemState[]): UploadBatchStatus {
  if (items.length === 0) {
    return "idle";
  }
  if (items.every((item) => item.status === "cancelled")) {
    return "cancelled";
  }
  if (items.every((item) => item.status === "complete" || item.status === "cancelled")) {
    return items.some((item) => item.status === "complete") ? "complete" : "cancelled";
  }
  if (items.some((item) => item.status === "failed")) {
    return "failed";
  }
  if (items.some((item) => item.status === "confirming")) {
    return "confirming";
  }
  if (items.some((item) => item.status === "uploading" || item.status === "uploaded")) {
    return "uploading";
  }
  if (items.some((item) => item.status === "queued")) {
    return "preparing";
  }
  return "uploading";
}

export function reduceUploadBatch(
  state: UploadBatchState,
  event: UploadStateEvent,
): UploadBatchState {
  switch (event.type) {
    case "RESET":
      return createEmptyUploadBatch();

    case "SELECT_FILES": {
      const items: UploadItemState[] = event.items.map((item, index) => ({
        localId: item.localId,
        uploadId: null,
        attachmentId: null,
        filename: item.filename,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        kind: item.kind,
        status: "queued",
        progress: 0,
        errorCode: null,
        errorMessage: null,
        previewUrl: item.previewUrl ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        order: index,
      }));
      return {
        batchId: null,
        status: "preparing",
        items,
        clientMessageId: event.clientMessageId ?? state.clientMessageId,
        body: event.body ?? state.body,
        errorMessage: null,
      };
    }

    case "PREPARE_SUCCESS": {
      const byLocal = new Map(event.uploads.map((u) => [u.localId, u]));
      const items = state.items.map((item) => {
        const mapped = byLocal.get(item.localId);
        if (!mapped) {
          return { ...item, status: "failed" as const, errorMessage: "Missing upload intent" };
        }
        return {
          ...item,
          uploadId: mapped.uploadId,
          attachmentId: mapped.attachmentId,
          status: "uploading" as const,
        };
      });
      return {
        ...state,
        batchId: event.batchId,
        status: "uploading",
        items,
        errorMessage: null,
      };
    }

    case "PREPARE_FAILURE":
      return {
        ...setItems(state, (item) =>
          item.status === "cancelled"
            ? item
            : {
                ...item,
                status: "failed",
                errorCode: event.code ?? "PREPARE_FAILED",
                errorMessage: event.message,
              },
        ),
        status: "failed",
        errorMessage: event.message,
      };

    case "UPLOAD_PROGRESS":
      return {
        ...setItems(state, (item) =>
          item.localId === event.localId && item.status === "uploading"
            ? { ...item, progress: Math.min(100, Math.max(0, event.progress)) }
            : item,
        ),
        status: "uploading",
      };

    case "UPLOAD_ITEM_SUCCESS":
      return {
        ...setItems(state, (item) =>
          item.localId === event.localId ? { ...item, status: "uploaded", progress: 100 } : item,
        ),
        status: "uploading",
      };

    case "UPLOAD_ITEM_FAILURE":
      return {
        ...setItems(state, (item) =>
          item.localId === event.localId
            ? {
                ...item,
                status: "failed",
                errorCode: event.code ?? "UPLOAD_FAILED",
                errorMessage: event.message,
              }
            : item,
        ),
        status: "failed",
        errorMessage: event.message,
      };

    case "CONFIRM_START":
      return {
        ...setItems(state, (item) =>
          item.status === "uploaded" || item.status === "uploading"
            ? { ...item, status: "confirming" }
            : item,
        ),
        status: "confirming",
      };

    case "CONFIRM_SUCCESS":
      return {
        ...setItems(state, (item) =>
          item.status === "confirming" || item.status === "uploaded"
            ? { ...item, status: "complete", progress: 100 }
            : item,
        ),
        status: "complete",
        errorMessage: null,
      };

    case "CONFIRM_FAILURE":
      return {
        ...setItems(state, (item) =>
          item.status === "confirming" || item.status === "uploaded"
            ? {
                ...item,
                status: "failed",
                errorCode: event.code ?? "CONFIRM_FAILED",
                errorMessage: event.message,
              }
            : item,
        ),
        status: "failed",
        errorMessage: event.message,
      };

    case "CANCEL": {
      if (event.localId) {
        const items = state.items.map((item) =>
          item.localId === event.localId &&
          item.status !== "complete" &&
          item.status !== "cancelled"
            ? { ...item, status: "cancelled" as const, progress: 0 }
            : item,
        );
        return { ...state, items, status: deriveBatchStatus(items) };
      }
      const items = state.items.map((item) =>
        item.status === "complete" ? item : { ...item, status: "cancelled" as const, progress: 0 },
      );
      return {
        ...state,
        items,
        status: "cancelled",
        errorMessage: null,
      };
    }

    case "RETRY": {
      const items = state.items.map((item) =>
        item.status === "failed"
          ? {
              ...item,
              status: "queued" as const,
              progress: 0,
              errorCode: null,
              errorMessage: null,
              uploadId: null,
              attachmentId: null,
            }
          : item,
      );
      return {
        ...state,
        batchId: null,
        status: "preparing",
        items,
        errorMessage: null,
      };
    }

    default:
      return state;
  }
}

export function uploadBatchAriaStatus(status: UploadBatchStatus): string {
  switch (status) {
    case "preparing":
    case "uploading":
    case "confirming":
      return "uploading";
    case "failed":
      return "failed";
    case "complete":
      return "complete";
    case "cancelled":
      return "cancelled";
    default:
      return "idle";
  }
}

export function activeUploadItems(state: UploadBatchState): UploadItemState[] {
  return state.items.filter((item) => item.status !== "cancelled" && item.status !== "complete");
}

export function allUploadsReadyToConfirm(state: UploadBatchState): boolean {
  const active = state.items.filter((item) => item.status !== "cancelled");
  return active.length > 0 && active.every((item) => item.status === "uploaded");
}
