"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { serializeDashboardListQuery } from "@/lib/dashboard/search-params";
import { cn } from "@/lib/utils";

export function SearchInput({
  param = "q",
  placeholder = "Search...",
  debounceMs = 300,
  className,
}: {
  param?: string;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const currentValue = searchParams.get(param) ?? "";
  const [value, setValue] = useState(currentValue);

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (value === currentValue) {
        return;
      }

      const params = serializeDashboardListQuery(
        param === "q" ? { q: value || undefined, page: 1 } : { page: 1 },
        Object.fromEntries(searchParams.entries()),
      );

      if (param !== "q") {
        if (value) {
          params.set(param, value);
        } else {
          params.delete(param);
        }
      }

      const query = params.toString();
      const nextUrl = (query ? `${pathname}?${query}` : pathname) as Route;
      startTransition(() => {
        router.replace(nextUrl);
      });
    }, debounceMs);

    return () => {
      window.clearTimeout(handle);
    };
  }, [value, currentValue, debounceMs, param, pathname, router, searchParams]);

  return (
    <div className={cn("relative w-full max-w-sm", className)}>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
      />
    </div>
  );
}
