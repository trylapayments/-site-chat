import { beforeEach, describe, expect, it, vi } from "vitest";
beforeEach(() => {
  vi.resetModules();
});
describe("speculative portal work", () => {
  it("waits for a usable screen and runs each request once", async () => {
    const { afterPortalReady, markPortalReady } = await import("./startup");
    const prepare = vi.fn();
    afterPortalReady(prepare);
    expect(prepare).not.toHaveBeenCalled();
    markPortalReady();
    markPortalReady();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("cancels waiting work when a workspace unmounts", async () => {
    const { afterPortalReady, markPortalReady } = await import("./startup");
    const prepare = vi.fn();
    const cancel = afterPortalReady(prepare);
    cancel();
    markPortalReady();
    expect(prepare).not.toHaveBeenCalled();
    afterPortalReady(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
