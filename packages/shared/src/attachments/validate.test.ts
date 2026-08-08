import { describe, expect, it } from "vitest";

import {
  validateAttachmentBatch,
  validateAttachmentFileDraft,
  validateMagicBytesAgainstDeclared,
} from "./validate.js";

describe("attachment validation", () => {
  it("accepts a valid image within limits", () => {
    const result = validateAttachmentFileDraft({
      filename: "photo.JPG",
      mimeType: "image/jpeg",
      sizeBytes: 1_024 * 512,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filename).toBe("photo.JPG");
      expect(result.value.kind).toBe("image");
      expect(result.value.mimeType).toBe("image/jpeg");
    }
  });

  it("enforces image and document size limits", () => {
    const image = validateAttachmentFileDraft({
      filename: "big.png",
      mimeType: "image/png",
      sizeBytes: 21 * 1024 * 1024,
    });
    expect(image.ok).toBe(false);
    if (!image.ok) {
      expect(image.error.code).toBe("FILE_TOO_LARGE");
    }

    const doc = validateAttachmentFileDraft({
      filename: "big.pdf",
      mimeType: "application/pdf",
      sizeBytes: 51 * 1024 * 1024,
    });
    expect(doc.ok).toBe(false);
  });

  it("rejects unsupported and executable uploads", () => {
    expect(
      validateAttachmentFileDraft({
        filename: "x.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 100,
      }).ok,
    ).toBe(false);

    expect(
      validateAttachmentFileDraft({
        filename: "run.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it("limits batch size", () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      filename: `f${String(i)}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
    }));
    const result = validateAttachmentBatch(files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TOO_MANY_FILES");
    }
  });

  it("validates magic bytes against declared MIME", () => {
    const ok = validateMagicBytesAgainstDeclared({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      declaredMime: "application/pdf",
      filename: "a.pdf",
    });
    expect(ok.ok).toBe(true);

    const bad = validateMagicBytesAgainstDeclared({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      declaredMime: "application/pdf",
      filename: "a.pdf",
    });
    expect(bad.ok).toBe(false);
  });

  it("sanitizes path-like filenames", () => {
    const result = validateAttachmentFileDraft({
      filename: "../../etc/passwd.png",
      mimeType: "image/png",
      sizeBytes: 12,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filename).toBe("passwd.png");
      expect(result.value.filename.includes("..")).toBe(false);
    }
  });
});
