"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { toAppRoute } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";

/** List-scoped search that always targets the inbox root (not /inbox/[id]). */
export function InboxListSearch({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const currentValue = searchParams.get("q") ?? "";
  const [value, setValue] = useState(currentValue);

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (value === currentValue) {
        return;
      }

      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      params.delete("page");

      const inboxRoot = pathname.replace(/\/inbox\/[^/]+$/, "/inbox");
      const query = params.toString();
      startTransition(() => {
        router.replace(toAppRoute(query ? `${inboxRoot}?${query}` : inboxRoot));
      });
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [value, currentValue, pathname, router, searchParams]);

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        className="text-inbox-muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        placeholder="Search contacts or messages…"
        aria-label="Search contacts or messages"
        className="border-inbox-border bg-inbox-surface focus-visible:ring-brand h-8 w-full rounded-md border pr-2.5 pl-8 text-[12px] outline-none focus-visible:ring-1"
      />
    </div>
  );
}
