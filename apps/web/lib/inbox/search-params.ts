import {
  conversationStatusSchema,
  listConversationsQuerySchema,
  type ListConversationsQuery,
} from "@site-chat/shared";

import {
  parseDashboardListQuery,
  type DashboardSearchParams,
} from "@/lib/dashboard/search-params";

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

export function parseInboxListQuery(
  params: DashboardSearchParams,
): ListConversationsQuery {
  const base = parseDashboardListQuery(params);
  const statusParam = getSingleParam(params, "status");
  const assignmentParam = getSingleParam(params, "assignment");

  const statusResult = conversationStatusSchema.safeParse(statusParam);
  const assignmentResult =
    listConversationsQuerySchema.shape.assignment.safeParse(assignmentParam);

  const query: ListConversationsQuery = { ...base };

  if (statusResult.success) {
    query.status = statusResult.data;
  }

  if (assignmentResult.success) {
    query.assignment = assignmentResult.data;
  }

  return query;
}

export function serializeInboxFilters(
  filters: Partial<Pick<ListConversationsQuery, "status" | "assignment">>,
  current?: DashboardSearchParams,
): URLSearchParams {
  const next = new URLSearchParams();

  if (current) {
    for (const [key, value] of Object.entries(current)) {
      if (["status", "assignment"].includes(key)) {
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

  if (filters.status) {
    next.set("status", filters.status);
  }

  if (filters.assignment) {
    next.set("assignment", filters.assignment);
  }

  return next;
}

export function formatConversationContactLabel(
  contact: { name: string | null; email: string | null } | null,
): string {
  if (!contact) {
    return "Unknown visitor";
  }
  return contact.name ?? contact.email ?? "Unknown visitor";
}

export function formatRelativeTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
