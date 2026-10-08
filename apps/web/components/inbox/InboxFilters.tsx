"use client";

import { assignmentMessagesEn } from "@site-chat/shared";
import { conversationStatusSchema } from "@site-chat/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { toAppRoute } from "@/lib/auth/redirect";

const messages = assignmentMessagesEn;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...conversationStatusSchema.options.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  })),
];

const ASSIGNMENT_TABS = [
  { value: "assigned_to_me", label: messages.filterMine },
  { value: "unassigned", label: messages.filterUnassigned },
  { value: "all", label: messages.filterAll },
] as const;

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function InboxFilters() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function pushWithParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    params.delete("page");
    const query = params.toString();
    router.push(toAppRoute(query ? `${pathname}?${query}` : pathname));
  }

  const assignmentValue = searchParams.get("assignment") ?? "all";

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={messages.filterLabel}
        className="flex flex-wrap gap-1"
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
              className={
                selected
                  ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                  : "text-muted-foreground hover:bg-muted rounded-md px-3 py-1.5 text-sm font-medium"
              }
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
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4">
        <FilterSelect
          label="Status"
          value={searchParams.get("status") ?? ""}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            pushWithParams((params) => {
              if (value) {
                params.set("status", value);
              } else {
                params.delete("status");
              }
            });
          }}
        />
      </div>
    </div>
  );
}
