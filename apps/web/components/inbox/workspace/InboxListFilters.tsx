"use client";

import { assignmentMessagesEn } from "@site-chat/shared";
import { conversationStatusSchema } from "@site-chat/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { toAppRoute } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";

const messages = assignmentMessagesEn;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...conversationStatusSchema.options.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  })),
];

const ASSIGNMENT_TABS = [
  { value: "all", label: "All" },
  { value: "assigned_to_me", label: messages.filterMine },
  { value: "unassigned", label: messages.filterUnassigned },
] as const;

export function InboxListFilters() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function pushWithParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    params.delete("page");
    const query = params.toString();
    const inboxRoot = pathname.replace(/\/inbox\/[^/]+$/, "/inbox");
    router.push(toAppRoute(query ? `${inboxRoot}?${query}` : inboxRoot));
  }

  const assignmentValue = searchParams.get("assignment") ?? "all";

  return (
    <div className="bg-inbox-panel space-y-2.5 border-b border-inbox-border/80 pb-2.5">
      <div
        role="tablist"
        aria-label={messages.filterLabel}
        className="flex gap-0 px-2"
        data-testid="inbox-assignment-tabs"
      >
        {ASSIGNMENT_TABS.map((tab) => {
          const selected =
            tab.value === "all"
              ? assignmentValue === "all" || assignmentValue === ""
              : assignmentValue === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`inbox-assignment-tab-${tab.value}`}
              className={cn(
                "relative px-3.5 py-2.5 text-[13px] font-medium transition-colors",
                selected
                  ? "text-brand"
                  : "text-inbox-muted hover:text-neutral-800",
              )}
              onClick={() => {
                pushWithParams((params) => {
                  if (tab.value === "all") {
                    params.delete("assignment");
                  } else {
                    params.set("assignment", tab.value);
                  }
                });
              }}
            >
              {tab.label}
              {selected ? (
                <span
                  className="bg-brand absolute inset-x-2.5 bottom-0 h-0.5 rounded-full"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-4">
        <label className="sr-only" htmlFor="inbox-status-filter">
          Status
        </label>
        <select
          id="inbox-status-filter"
          value={searchParams.get("status") ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            pushWithParams((params) => {
              if (value) {
                params.set("status", value);
              } else {
                params.delete("status");
              }
            });
          }}
          className="border-inbox-border bg-inbox-surface text-inbox-muted focus-visible:ring-brand/30 h-9 w-full rounded-lg border px-2.5 text-[13px] shadow-[var(--inbox-shadow)] focus-visible:ring-1 focus-visible:outline-none"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
