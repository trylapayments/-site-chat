import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { prepareWidgetImage } from "./prepare-image";
const draw = vi.fn();
const revoke = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 1005;
      naturalHeight = 1085;
      src = "";
      decode() {
        return Promise.resolve();
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ clearRect: vi.fn(), drawImage: draw }),
      toBlob: (cb: (blob: Blob) => void) =>
        { cb(new Blob(["png"], { type: "image/png" })); },
    }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("accepts the previously rejected logo by fitting it inside 1024 pixels", async () => {
  const result = await prepareWidgetImage(
    new File(["source"], "logo.png", { type: "image/png" }),
  );
  expect(draw.mock.calls[0]?.slice(3)).toEqual([948, 1024]);
  expect(result.type).toBe("image/png");
  expect(result.size).toBeLessThanOrEqual(524288);
  expect(revoke).toHaveBeenCalledWith("blob:test");
});
it("rejects unsupported files before uploading", async () => {
  await expect(
    prepareWidgetImage(
      new File(["svg"], "logo.svg", { type: "image/svg+xml" }),
    ),
  ).rejects.toThrow("PNG, JPEG, or WebP");
});
