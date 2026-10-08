import { describe, expect, it } from "vitest";
import { scanBundlePaths } from "./verify-bundle-paths.js";

describe("widget bundle path hygiene", () => {
  it("committed bundles contain no machine-specific absolute paths", () => {
    expect(scanBundlePaths()).toEqual([]);
  });
});
