import { describe, expect, it } from "vitest";

import { createGlobalSearchRequestGuard } from "./request-guard";

describe("createGlobalSearchRequestGuard", () => {
  it("accepts only the latest request for the active workspace", () => {
    const guard = createGlobalSearchRequestGuard();
    const first = guard.begin("acme");
    const second = guard.begin("acme");
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidate drops in-flight tokens (close palette)", () => {
    const guard = createGlobalSearchRequestGuard();
    const token = guard.begin("acme");
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("workspace switch invalidates prior workspace responses", () => {
    const guard = createGlobalSearchRequestGuard();
    const fromA = guard.begin("workspace-a");
    guard.resetWorkspace("workspace-b");
    const fromB = guard.begin("workspace-b");
    expect(guard.isCurrent(fromA)).toBe(false);
    expect(guard.isCurrent(fromB)).toBe(true);
  });

  it("stale response from workspace A cannot replace B", () => {
    const guard = createGlobalSearchRequestGuard();
    const a = guard.begin("workspace-a");
    const b = guard.begin("workspace-b");
    expect(guard.isCurrent(a)).toBe(false);
    expect(guard.isCurrent(b)).toBe(true);
    expect(a.workspaceSlug).toBe("workspace-a");
    expect(b.workspaceSlug).toBe("workspace-b");
  });
});
