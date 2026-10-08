import { describe, expect, it } from "vitest";

import {
  buildPageMeta,
  parsePage,
  parsePageSize,
  toOffsetLimit,
} from "@/lib/dashboard/pagination";

describe("pagination helpers", () => {
  it("clamps invalid page values to 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-1")).toBe(1);
    expect(parsePage("abc")).toBe(1);
  });

  it("parses valid page values", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("falls back to default page size for invalid values", () => {
    expect(parsePageSize(undefined)).toBe(25);
    expect(parsePageSize("999")).toBe(25);
  });

  it("computes offset and limit", () => {
    expect(toOffsetLimit(1, 25)).toEqual({ offset: 0, limit: 25 });
    expect(toOffsetLimit(3, 10)).toEqual({ offset: 20, limit: 10 });
  });

  it("builds page metadata", () => {
    expect(
      buildPageMeta({
        total: 51,
        page: 2,
        pageSize: 25,
      }),
    ).toEqual({
      total: 51,
      page: 2,
      pageSize: 25,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
      from: 26,
      to: 50,
    });
  });

  it("handles empty totals", () => {
    expect(
      buildPageMeta({
        total: 0,
        page: 5,
        pageSize: 25,
      }),
    ).toEqual({
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
      from: 0,
      to: 0,
    });
  });
});
