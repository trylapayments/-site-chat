import { describe, expect, it } from "vitest";

import {
  getListQueryOffsetLimit,
  getListQueryPageMeta,
  parseDashboardListQuery,
  serializeDashboardListQuery,
} from "@/lib/dashboard/search-params";

describe("dashboard search params", () => {
  it("parses list query params", () => {
    expect(
      parseDashboardListQuery({
        q: "  acme ",
        page: "2",
        pageSize: "50",
        sort: "-updated_at",
      }),
    ).toEqual({
      q: "acme",
      page: 2,
      pageSize: 50,
      sort: "-updated_at",
    });
  });

  it("falls back when params are invalid", () => {
    expect(
      parseDashboardListQuery({
        page: "0",
        pageSize: "999",
      }),
    ).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it("serializes list query params and preserves unrelated params", () => {
    const params = serializeDashboardListQuery(
      {
        q: "acme",
        page: 2,
        pageSize: 50,
        sort: "-updated_at",
      },
      {
        status: "open",
        page: "1",
      },
    );

    expect(params.get("q")).toBe("acme");
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("50");
    expect(params.get("sort")).toBe("-updated_at");
    expect(params.get("status")).toBe("open");
  });

  it("derives offset/limit and page meta from parsed query", () => {
    const query = parseDashboardListQuery({ page: "2", pageSize: "10" });

    expect(getListQueryOffsetLimit(query)).toEqual({ offset: 10, limit: 10 });
    expect(getListQueryPageMeta(query, 25)).toMatchObject({
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
  });
});
