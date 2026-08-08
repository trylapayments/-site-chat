import { validateAttachmentBatch } from "@site-chat/shared";
import { describe, expect, it } from "vitest";

import { AttachmentValidationError } from "@/lib/attachments/service";

describe("AttachmentValidationError", () => {
  it("exposes code and message for API mapping", () => {
    const err = new AttachmentValidationError(
      "SIZE_MISMATCH",
      "Uploaded size does not match declared size",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AttachmentValidationError");
    expect(err.code).toBe("SIZE_MISMATCH");
    expect(err.message).toBe("Uploaded size does not match declared size");
  });
});

describe("validateAttachmentBatch (service initiate path)", () => {
  it("accepts a valid batch the service would pass through", () => {
    const batch = validateAttachmentBatch([
      {
        filename: "photo.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
      {
        filename: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096,
      },
    ]);

    expect(batch.ok).toBe(true);
    if (batch.ok) {
      expect(batch.value).toHaveLength(2);
      expect(batch.value[0]?.kind).toBe("image");
      expect(batch.value[1]?.kind).toBe("document");
    }
  });

  it("surfaces codes that AttachmentValidationError would wrap", () => {
    const batch = validateAttachmentBatch([
      {
        filename: "virus.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 100,
      },
    ]);

    expect(batch.ok).toBe(false);
    if (!batch.ok) {
      const err = new AttachmentValidationError(
        batch.error.code,
        batch.error.message,
      );
      expect(err.code).toBe(batch.error.code);
      expect(err.message).toBe(batch.error.message);
    }
  });

  it("rejects empty batches before initiate", () => {
    const batch = validateAttachmentBatch([]);
    expect(batch.ok).toBe(false);
  });
});
