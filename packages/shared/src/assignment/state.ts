import type { ConversationListItem } from "../schemas/conversation.js";
import type { WorkspaceMemberOption } from "../schemas/conversation.js";

export type InboxAssignmentFilter = "all" | "unassigned" | "assigned_to_me";

/**
 * Pure filter for Mine / Unassigned / All inbox tabs.
 * Does not mutate ordering — callers keep last_message_at sort.
 */
export function conversationMatchesAssignmentFilter(
  item: Pick<ConversationListItem, "assigned_to">,
  filter: InboxAssignmentFilter | undefined,
  memberId: string | undefined,
): boolean {
  if (!filter || filter === "all") {
    return true;
  }

  if (filter === "unassigned") {
    return item.assigned_to === null;
  }

  // assigned_to_me
  if (!memberId) {
    return false;
  }
  return item.assigned_to?.member_id === memberId;
}

export type TakeDecision =
  { action: "take" } | { action: "noop" } | { action: "conflict"; assigneeMemberId: string };

/**
 * Client-side preview of Take semantics (server remains authoritative).
 */
export function evaluateTakeDecision(
  currentAssigneeMemberId: string | null | undefined,
  callerMemberId: string,
): TakeDecision {
  if (currentAssigneeMemberId == null) {
    return { action: "take" };
  }
  if (currentAssigneeMemberId === callerMemberId) {
    return { action: "noop" };
  }
  return { action: "conflict", assigneeMemberId: currentAssigneeMemberId };
}

export type AssignmentMutationKind = "assigned" | "transferred" | "unassigned" | "noop";

export function classifyAssignmentMutation(
  fromMemberId: string | null | undefined,
  toMemberId: string | null | undefined,
): AssignmentMutationKind {
  if (fromMemberId === toMemberId || (fromMemberId == null && toMemberId == null)) {
    return "noop";
  }
  if (fromMemberId == null && toMemberId != null) {
    return "assigned";
  }
  if (fromMemberId != null && toMemberId == null) {
    return "unassigned";
  }
  return "transferred";
}

/**
 * Filter assignable members for the picker (active messaging roles only).
 * Inactive/removed members are already excluded by list_assignable_members;
 * this also supports client-side search and dropping a vanished current assignee.
 */
export function filterAssignableMembers(
  members: WorkspaceMemberOption[],
  options: {
    search?: string;
    currentAssigneeMemberId?: string | null;
    includeCurrentEvenIfMissing?: boolean;
    currentAssigneeLabel?: string | null;
  } = {},
): WorkspaceMemberOption[] {
  const search = options.search?.trim().toLowerCase() ?? "";
  let list = members.filter(
    (member) => member.role === "owner" || member.role === "admin" || member.role === "agent",
  );

  if (search) {
    list = list.filter((member) => member.display_label.toLowerCase().includes(search));
  }

  if (
    options.includeCurrentEvenIfMissing &&
    options.currentAssigneeMemberId &&
    !list.some((m) => m.member_id === options.currentAssigneeMemberId)
  ) {
    // Member disappeared while picker open — show a non-selectable placeholder? No:
    // keep list as-is; callers indicate current assignee separately.
  }

  return list;
}

/**
 * Reconcile optimistic assignee with authoritative server state after Take.
 */
export function reconcileOptimisticAssignee<T extends { member_id: string; display_label: string }>(
  optimistic: T | null,
  authoritative: T | null,
  conflict: boolean,
): T | null {
  if (conflict) {
    return authoritative;
  }
  return authoritative ?? optimistic;
}
