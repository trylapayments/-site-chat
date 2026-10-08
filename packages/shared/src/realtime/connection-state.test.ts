import { describe, expect, it } from "vitest";

import {
  initialConnectionState,
  nextBackoffDelayMs,
  onManualRetry,
  onTransportConnected,
  onTransportDisconnected,
  shouldScheduleCatchUp,
} from "./connection-state.js";

describe("connection-state", () => {
  it("resets attempts when connected", () => {
    const next = onTransportConnected(onTransportDisconnected(initialConnectionState()));
    expect(next.status).toBe("connected");
    expect(next.attempt).toBe(0);
  });

  it("escalates to failed after max attempts", () => {
    let state = initialConnectionState();
    for (let index = 0; index < 10; index += 1) {
      state = onTransportDisconnected(state);
    }
    expect(state.status).toBe("failed");
  });

  it("manual retry restarts attempts", () => {
    expect(onManualRetry()).toEqual({ status: "connecting", attempt: 0 });
  });

  it("uses exponential backoff with cap", () => {
    expect(nextBackoffDelayMs(0)).toBeGreaterThanOrEqual(1000);
    expect(nextBackoffDelayMs(10)).toBeLessThanOrEqual(30500);
  });

  it("schedules catch-up when reconnect succeeds", () => {
    expect(shouldScheduleCatchUp("reconnecting", "connected")).toBe(true);
    expect(shouldScheduleCatchUp("connected", "connected")).toBe(false);
  });
});
