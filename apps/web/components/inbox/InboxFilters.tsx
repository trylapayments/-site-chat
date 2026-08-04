"use client";

import { conversationStatusSchema } from "@site-chat/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { toAppRoute } from "@/lib/auth/redirect";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...conversationStatusSchema.options.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  })),
];

const ASSIGNMENT_OPTIONS = [
  { value: "", label: "All conversations" },
  { value: "unassigned", label: "Unassigned" },
  { value: "assigned_to_me", label: "Assigned to me" },
];

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

  return (
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
      <FilterSelect
        label="Assignment"
        value={searchParams.get("assignment") ?? ""}
        options={ASSIGNMENT_OPTIONS}
        onChange={(value) => {
          pushWithParams((params) => {
            if (value) {
              params.set("assignment", value);
            } else {
              params.delete("assignment");
            }
          });
        }}
      />
    </div>
  );
}
