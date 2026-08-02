export const DEFAULT_PAGE_SIZE = 25;

export function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

export function parsePageSize(
  value: string | undefined,
  allowed: readonly number[] = [10, 25, 50],
): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed) || !allowed.includes(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }

  return parsed;
}

export function toOffsetLimit(
  page: number,
  pageSize: number,
): {
  offset: number;
  limit: number;
} {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);

  return {
    offset: (safePage - 1) * safePageSize,
    limit: safePageSize,
  };
}

export type PageMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  from: number;
  to: number;
};

export function buildPageMeta({
  total,
  page,
  pageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
}): PageMeta {
  const safeTotal = Math.max(0, total);
  const safePageSize = Math.max(1, pageSize);
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / safePageSize);
  const safePage =
    totalPages === 0 ? 1 : Math.min(Math.max(1, page), totalPages);
  const from = safeTotal === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const to = safeTotal === 0 ? 0 : Math.min(safePage * safePageSize, safeTotal);

  return {
    total: safeTotal,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    hasNext: totalPages > 0 && safePage < totalPages,
    hasPrev: totalPages > 0 && safePage > 1,
    from,
    to,
  };
}
