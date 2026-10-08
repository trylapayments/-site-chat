import { expect, it } from "vitest";
import { realtimeRetryDelay } from "./retry-delay";
it("spreads reconnects rather than synchronizing all clients", () => {
  expect(realtimeRetryDelay(0, () => 0)).toBe(500);
  expect(realtimeRetryDelay(0, () => 1)).toBe(1000);
  expect(realtimeRetryDelay(3, () => 0.5)).toBe(6000);
});
it("bounds retries after long outages", () => {
  expect(realtimeRetryDelay(1000, () => 0)).toBe(7500);
  expect(realtimeRetryDelay(1000, () => 1)).toBe(15000);
});
