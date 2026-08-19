import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage/supabase-object-storage", () => ({
  createSupabaseObjectStorage: vi.fn(),
}));

const {
  WidgetAssetValidationError,
  sanitizeWidgetAssetFilename,
  validateWidgetAssetContents,
  validateWidgetAssetUpload,
} = await import("./assets");

describe("Widget Studio asset validation", () => {
  it("sanitizes filenames and enforces MIME/extension agreement", () => {
    expect(sanitizeWidgetAssetFilename("../../brand logo.png")).toBe(
      "brand logo.png",
    );
    expect(() =>
      validateWidgetAssetUpload({
        kind: "logo",
        filename: "brand.jpg",
        mimeType: "image/png",
        sizeBytes: 100,
      }),
    ).toThrow(WidgetAssetValidationError);
  });

  it("reads valid PNG dimensions", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    bytes.set([0, 0, 0, 32], 16);
    bytes.set([0, 0, 0, 24], 20);

    expect(validateWidgetAssetContents(bytes, "image/png")).toEqual({
      width: 32,
      height: 24,
    });
  });

  it("rejects active content in SVG assets", () => {
    const bytes = new TextEncoder().encode(
      '<svg width="64" height="64"><script>alert(1)</script></svg>',
    );

    expect(() => validateWidgetAssetContents(bytes, "image/svg+xml")).toThrow(
      "SVG files cannot contain scripts or external resources.",
    );
  });
});
