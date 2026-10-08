import { describe, expect, it } from "vitest";

import {
  allUploadsReadyToConfirm,
  createEmptyUploadBatch,
  reduceUploadBatch,
  uploadBatchAriaStatus,
} from "./upload-state.js";

describe("upload state machine", () => {
  it("moves from select → prepare → upload → confirm → complete", () => {
    let state = createEmptyUploadBatch();
    state = reduceUploadBatch(state, {
      type: "SELECT_FILES",
      clientMessageId: "11111111-1111-1111-1111-111111111111",
      items: [
        {
          localId: "a",
          filename: "a.png",
          mimeType: "image/png",
          sizeBytes: 10,
          kind: "image",
        },
      ],
    });
    expect(state.status).toBe("preparing");
    expect(uploadBatchAriaStatus(state.status)).toBe("uploading");

    state = reduceUploadBatch(state, {
      type: "PREPARE_SUCCESS",
      batchId: "22222222-2222-2222-2222-222222222222",
      uploads: [
        {
          localId: "a",
          uploadId: "33333333-3333-3333-3333-333333333333",
          attachmentId: "44444444-4444-4444-4444-444444444444",
        },
      ],
    });
    expect(state.status).toBe("uploading");

    state = reduceUploadBatch(state, {
      type: "UPLOAD_PROGRESS",
      localId: "a",
      progress: 40,
    });
    expect(state.items[0]?.progress).toBe(40);

    state = reduceUploadBatch(state, { type: "UPLOAD_ITEM_SUCCESS", localId: "a" });
    expect(allUploadsReadyToConfirm(state)).toBe(true);

    state = reduceUploadBatch(state, { type: "CONFIRM_START" });
    state = reduceUploadBatch(state, { type: "CONFIRM_SUCCESS" });
    expect(state.status).toBe("complete");
    expect(uploadBatchAriaStatus(state.status)).toBe("complete");
  });

  it("supports failure, cancel, and retry without ghost completion", () => {
    let state = reduceUploadBatch(createEmptyUploadBatch(), {
      type: "SELECT_FILES",
      items: [
        {
          localId: "a",
          filename: "a.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          kind: "document",
        },
      ],
    });

    state = reduceUploadBatch(state, {
      type: "PREPARE_FAILURE",
      message: "network",
    });
    expect(state.status).toBe("failed");
    expect(uploadBatchAriaStatus(state.status)).toBe("failed");

    state = reduceUploadBatch(state, { type: "RETRY" });
    expect(state.status).toBe("preparing");
    expect(state.items[0]?.status).toBe("queued");

    state = reduceUploadBatch(state, { type: "CANCEL" });
    expect(state.status).toBe("cancelled");
    expect(state.items.every((item) => item.status === "cancelled")).toBe(true);
  });

  it("preserves ordering across multiple files", () => {
    const state = reduceUploadBatch(createEmptyUploadBatch(), {
      type: "SELECT_FILES",
      items: [
        {
          localId: "a",
          filename: "1.png",
          mimeType: "image/png",
          sizeBytes: 1,
          kind: "image",
        },
        {
          localId: "b",
          filename: "2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          kind: "document",
        },
      ],
    });
    expect(state.items.map((item) => item.order)).toEqual([0, 1]);
    expect(state.items.map((item) => item.filename)).toEqual(["1.png", "2.pdf"]);
  });
});
