import {
  ALLOWED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  listQuerySchema,
  type ListQuery,
} from "@site-chat/shared";

import {
  buildPageMeta,
  parsePage,
  parsePageSize,
  toOffsetLimit,
} from "@/lib/dashboard/pagination";

export type DashboardSearchParams = Record<
  string,
  string | string[] | undefined
>;

function getSingleParam(
  params: DashboardSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function parseDashboardListQuery(
  params: DashboardSearchParams,
): ListQuery {
  const parsed = listQuerySchema.safeParse({
    q: getSingleParam(params, "q") || undefined,
    page: getSingleParam(params, "page"),
    pageSize: getSingleParam(params, "pageSize"),
    sort: getSingleParam(params, "sort") || undefined,
  });

  if (parsed.success) {
    return parsed.data;
  }

  return {
    page: parsePage(getSingleParam(params, "page")),
    pageSize: parsePageSize(
      getSingleParam(params, "pageSize"),
      ALLOWED_PAGE_SIZES,
    ),
  };
}

export function serializeDashboardListQuery(
  query: Partial<ListQuery>,
  current?: DashboardSearchParams,
): URLSearchParams {
  const next = new URLSearchParams();

  if (current) {
    for (const [key, value] of Object.entries(current)) {
      if (["q", "page", "pageSize", "sort"].includes(key)) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          next.append(key, item);
        }
      } else if (value !== undefined) {
        next.set(key, value);
      }
    }
  }

  if (query.q) {
    next.set("q", query.q);
  }

  const page = query.page ?? parsePage(getSingleParam(current ?? {}, "page"));
  const pageSize =
    query.pageSize ??
    parsePageSize(
      getSingleParam(current ?? {}, "pageSize"),
      ALLOWED_PAGE_SIZES,
    );

  if (page > 1) {
    next.set("page", String(page));
  }

  if (pageSize !== DEFAULT_PAGE_SIZE) {
    next.set("pageSize", String(pageSize));
  }

  if (query.sort) {
    next.set("sort", query.sort);
  }

  return next;
}

export function getListQueryOffsetLimit(query: ListQuery): {
  offset: number;
  limit: number;
} {
  return toOffsetLimit(query.page, query.pageSize);
}

export function getListQueryPageMeta(
  query: ListQuery,
  total: number,
): ReturnType<typeof buildPageMeta> {
  return buildPageMeta({
    total,
    page: query.page,
    pageSize: query.pageSize,
  });
}
