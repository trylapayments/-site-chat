import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "page.tsx"),
  "utf8",
);

describe("widget embed page", () => {
  it("renders app.js as a native module script without Next Script hydration", () => {
    expect(pageSource).toContain('id="root"');
    expect(pageSource).toContain('type="module" src="/widget/app.js"');
    expect(pageSource).not.toContain("afterInteractive");
    expect(pageSource).not.toContain("data-nscript");
    expect(pageSource).not.toContain("next/script");
  });
});
