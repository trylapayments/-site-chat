import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("widget embed route", () => {
  it("returns a raw HTML shell with native app.js and no Next page runtime markers", async () => {
    const response = GET();
    const html = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain('id="root"');
    expect(html).toContain('type="module" src="/widget/app.js"');
    expect(html).toContain("background: transparent");
    expect(html).not.toContain("afterInteractive");
    expect(html).not.toContain("data-nscript");
    expect(html).not.toContain("next/script");
    expect(html).not.toContain("__next_f");
    expect(html).not.toContain("main-app");
  });
});
