"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { serializeDashboardListQuery } from "@/lib/dashboard/search-params";
import type { PageMeta } from "@/lib/dashboard/pagination";
import { cn } from "@/lib/utils";

export function ListPagination({
  pageMeta,
  className,
}: {
  pageMeta: PageMeta;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pageMeta.total === 0) {
    return null;
  }

  const currentParams = Object.fromEntries(searchParams.entries());

  const previousParams = serializeDashboardListQuery(
    { page: Math.max(1, pageMeta.page - 1) },
    currentParams,
  );
  const nextParams = serializeDashboardListQuery(
    { page: pageMeta.page + 1 },
    currentParams,
  );

  const previousHref = previousParams.toString()
    ? `${pathname}?${previousParams.toString()}`
    : pathname;
  const nextHref = `${pathname}?${nextParams.toString()}`;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-muted-foreground text-sm">
        Showing {pageMeta.from}–{pageMeta.to} of {pageMeta.total}
      </p>
      <div className="flex items-center gap-2">
        {pageMeta.hasPrev ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={previousHref as Route}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {pageMeta.hasNext ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={nextHref as Route}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
