import { describe, expect, it } from "vitest";
import { createRequestFlight } from "./request-flight";

describe("conversation catch-up requests", () => {
  it("coalesces concurrent reconnects and permits a later retry", async () => {
    const gate = createRequestFlight();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const first = gate.run(async (current) => {
      calls++;
      await pending;
      expect(current()).toBe(true);
    });
    await gate.run(() => {
      calls++;
      return Promise.resolve();
    });
    expect(calls).toBe(1);
    release();
    await first;
    await gate.run(() => {
      calls++;
      return Promise.resolve();
    });
    expect(calls).toBe(2);
  });
  it("rejects late results after switching conversations without cancelling the new request", async () => {
    const gate = createRequestFlight();
    let release!: () => void;
    let oldCurrent!: () => boolean;
    const first = gate.run(async (current) => {
      oldCurrent = current;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    gate.invalidate();
    expect(oldCurrent()).toBe(false);
    await gate.run(async (current) => {
      release();
      await first;
      expect(current()).toBe(true);
    });
  });
  it("releases failed requests so recovery can retry", async () => {
    const gate = createRequestFlight();
    await expect(
      gate.run(() => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    await gate.run((current) => {
      expect(current()).toBe(true);
      return Promise.resolve();
    });
  });
});
