import { expect, it } from "vitest";
import { formatVisitorDuration } from "./duration";
const start = "2026-10-07T00:00:00.000Z";
it.each([
  [25, "0m 25s"],
  [59, "0m 59s"],
  [60, "1m 0s"],
  [3599, "59m 59s"],
  [3600, "1h 0m"],
  [94985, "1d 2h 23m"],
  [172800, "2d 0h 0m"],
])("formats %s seconds without overflowing minutes", (seconds, expected) => {
  expect(
    formatVisitorDuration(start, Date.parse(start) + seconds * 1000),
  ).toBe(expected);
});
it("handles invalid and future timestamps", () => {
  expect(formatVisitorDuration("invalid", Date.now())).toBe("Unavailable");
  expect(formatVisitorDuration(start, Date.parse(start) - 1000)).toBe("0m 0s");
});
