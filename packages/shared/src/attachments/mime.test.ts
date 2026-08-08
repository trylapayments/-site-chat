import { describe, expect, it } from "vitest";

import {
  detectMimeFromMagicBytes,
  isRejectedAttachmentExtension,
  isRejectedAttachmentMime,
  lookupAttachmentTypeByExtension,
  lookupAttachmentTypeByMime,
} from "./mime.js";

describe("attachment mime registry", () => {
  it("resolves supported image and document types", () => {
    expect(lookupAttachmentTypeByMime("image/png")?.kind).toBe("image");
    expect(lookupAttachmentTypeByExtension("report.PDF")?.mimeType).toBe("application/pdf");
    expect(lookupAttachmentTypeByExtension("sheet.xlsx")?.label).toBe("Excel");
    expect(lookupAttachmentTypeByExtension("deck.pptx")?.kind).toBe("document");
  });

  it("rejects executable and scriptable types", () => {
    expect(isRejectedAttachmentMime("image/svg+xml")).toBe(true);
    expect(isRejectedAttachmentMime("text/html")).toBe(true);
    expect(isRejectedAttachmentExtension("payload.exe")).toBe(true);
    expect(isRejectedAttachmentExtension("note.svg")).toBe(true);
    expect(lookupAttachmentTypeByExtension("malware.js")).toBeNull();
  });

  it("detects magic bytes for common formats", () => {
    expect(detectMimeFromMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      detectMimeFromMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(detectMimeFromMagicBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
      "application/pdf",
    );
    expect(detectMimeFromMagicBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "archive.zip")).toBe(
      "application/zip",
    );
    expect(detectMimeFromMagicBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "doc.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("does not treat SVG-like XML as an allowed image", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(detectMimeFromMagicBytes(svg, "icon.svg")).toBeNull();
  });
});
