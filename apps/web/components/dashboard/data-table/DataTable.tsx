"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataTableSkeleton } from "@/components/dashboard/feedback/DataTableSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toAppRoute } from "@/lib/auth/redirect";
import { serializeDashboardListQuery } from "@/lib/dashboard/search-params";
import { cn } from "@/lib/utils";
import { parseSortParam } from "@site-chat/shared";
import type { LucideIcon } from "lucide-react";

function SortableHeader({
  label,
  sortKey,
  currentSort,
  pathname,
  searchParams,
}: {
  label: string;
  sortKey: string;
  currentSort?: string;
  pathname: string;
  searchParams: URLSearchParams;
}) {
  const parsed = parseSortParam(currentSort);
  const isActive = parsed !== undefined && parsed.field === sortKey;
  const nextSort =
    !isActive || parsed.direction === "desc" ? sortKey : `-${sortKey}`;

  const params = serializeDashboardListQuery(
    { sort: nextSort, page: 1 },
    Object.fromEntries(searchParams.entries()),
  );
  const href = `${pathname}?${params.toString()}`;

  return (
    <Link
      href={toAppRoute(href)}
      className="hover:text-foreground inline-flex items-center gap-1"
    >
      {label}
      {isActive ? (
        parsed.direction === "asc" ? (
          <ArrowUp className="size-3.5" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-3.5" aria-hidden="true" />
        )
      ) : (
        <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />
      )}
    </Link>
  );
}

export function DataTable<TData>({
  columns,
  data,
  sortableColumns = [],
  currentSort,
  loading = false,
  emptyState,
  className,
}: {
  columns: ColumnDef<TData>[];
  data: TData[];
  sortableColumns?: string[];
  currentSort?: string;
  loading?: boolean;
  emptyState?: {
    icon: LucideIcon;
    title: string;
    description: string;
    action?: React.ReactNode;
  };
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sorting = useMemo<SortingState>(() => {
    const parsed = parseSortParam(currentSort);
    if (!parsed) {
      return [];
    }

    return [{ id: parsed.field, desc: parsed.direction === "desc" }];
  }, [currentSort]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
  });

  if (loading) {
    return (
      <DataTableSkeleton
        rows={8}
        columns={Math.max(columns.length, 1)}
        className={className}
      />
    );
  }

  if (data.length === 0 && emptyState) {
    return (
      <EmptyState
        icon={emptyState.icon}
        title={emptyState.title}
        description={emptyState.description}
        action={emptyState.action}
        variant="compact"
        className={className}
      />
    );
  }

  return (
    <div className={cn("rounded-lg border", className)}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortKey = sortableColumns.find(
                  (columnId) => columnId === header.column.id,
                );
                const headerDef = header.column.columnDef.header;
                const sortLabel =
                  typeof headerDef === "string"
                    ? headerDef
                    : (sortKey ?? header.id);

                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : sortKey ? (
                      <SortableHeader
                        label={sortLabel}
                        sortKey={sortKey}
                        currentSort={currentSort}
                        pathname={pathname}
                        searchParams={searchParams}
                      />
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
