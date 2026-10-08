import { expect, it } from "vitest";
import { effectiveOperatorStatus, aggregateOperatorStatus } from "./status";
const now = Date.parse("2026-10-04T21:00:00Z");
const row = {
  status: "available",
  last_activity_at: "2026-10-04T20:55:00Z",
  idle_timeout_minutes: 5,
};
it("goes Away at the configured idle threshold and never automatically Offline", () => {
  expect(effectiveOperatorStatus(row, now - 1)).toBe("available");
  expect(effectiveOperatorStatus(row, now)).toBe("away");
  expect(effectiveOperatorStatus(row, now + 86400_000)).toBe("away");
  expect(
    effectiveOperatorStatus({ ...row, idle_timeout_minutes: 10 }, now),
  ).toBe("available");
  expect(
    effectiveOperatorStatus(
      { ...row, idle_timeout_minutes: 0 },
      now + 86400_000,
    ),
  ).toBe("available");
});
it("activity resumes only automatic Away; manual Away and Offline persist", () => {
  const active = { ...row, last_activity_at: new Date(now).toISOString() };
  expect(effectiveOperatorStatus(active, now)).toBe("available");
  expect(effectiveOperatorStatus({ ...active, status: "away" }, now)).toBe(
    "away",
  );
  expect(effectiveOperatorStatus({ ...active, status: "offline" }, now)).toBe(
    "offline",
  );
  expect(aggregateOperatorStatus(["away", "available"])).toBe("available");
  expect(aggregateOperatorStatus(["away", "offline"])).toBe("away");
});
