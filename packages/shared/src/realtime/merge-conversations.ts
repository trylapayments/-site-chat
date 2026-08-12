import type { ConversationListItem } from "../schemas/conversation.js";
import type { OperatorConversationChange, OperatorMessageChange } from "../schemas/realtime.js";
import { conversationMatchesAssignmentFilter } from "../assignment/state.js";

/**
 * Build a list-row stub from a CDC conversation payload when the inbox does not
 * yet have the conversation. Contact enrichment arrives via refreshList.
 */
export function conversationListItemFromChange(
  change: OperatorConversationChange,
): ConversationListItem {
  return {
    id: change.id,
    status: change.status,
    channel_type: "widget",
    assigned_to: null,
    contact: null,
    last_message_at: change.last_message_at,
    last_message_preview: change.last_message_preview,
    message_count: change.message_count,
    has_unread: true,
    unread_count: 1,
    created_at: change.updated_at,
  };
}

/**
 * Build a list-row stub from the first message INSERT for an unknown conversation
 * so the inbox can render the preview before list_conversations catch-up.
 */
export function conversationListItemFromMessage(
  message: OperatorMessageChange,
): ConversationListItem {
  const unread = message.sender_type === "visitor" ? 1 : 0;
  return {
    id: message.conversation_id,
    status: "open",
    channel_type: "widget",
    assigned_to: null,
    contact: null,
    last_message_at: message.created_at,
    last_message_preview: message.body.slice(0, 200),
    message_count: Math.max(1, message.sequence_number),
    has_unread: unread > 0,
    unread_count: unread,
    created_at: message.created_at,
  };
}

export function patchConversationListItem(
  item: ConversationListItem,
  change: Partial<OperatorConversationChange> & {
    has_unread?: boolean;
    unread_count?: number;
  },
): ConversationListItem {
  const unreadCount =
    change.unread_count !== undefined
      ? Math.max(0, change.unread_count)
      : change.has_unread === false
        ? 0
        : change.has_unread === true && item.unread_count === 0
          ? 1
          : item.unread_count;

  return {
    ...item,
    status: change.status ?? item.status,
    last_message_at:
      change.last_message_at !== undefined ? change.last_message_at : item.last_message_at,
    last_message_preview:
      change.last_message_preview !== undefined
        ? change.last_message_preview
        : item.last_message_preview,
    message_count: change.message_count !== undefined ? change.message_count : item.message_count,
    unread_count: unreadCount,
    has_unread: change.has_unread ?? unreadCount > 0,
    assigned_to:
      change.assigned_to !== undefined
        ? change.assigned_to === null
          ? null
          : // CDC carries assignee UUID only; keep existing enrichment when the
            // UUID is unchanged, otherwise clear label until list refresh.
            item.assigned_to?.member_id === change.assigned_to
            ? item.assigned_to
            : { member_id: change.assigned_to, display_label: item.assigned_to?.display_label ?? "…" }
        : item.assigned_to,
  };
}

/** True when CDC assignee UUID differs from the enriched list-row assignee. */
export function assignmentNeedsEnrichmentRefresh(
  item: ConversationListItem | undefined,
  change: Pick<OperatorConversationChange, "assigned_to">,
): boolean {
  if (change.assigned_to === undefined) {
    return false;
  }
  const currentId = item?.assigned_to?.member_id ?? null;
  if (change.assigned_to === null) {
    return currentId !== null;
  }
  if (currentId !== change.assigned_to) {
    return true;
  }
  // UUID matches but label may still be a placeholder from patch.
  return item?.assigned_to?.display_label === "…";
}

export function sortConversationItems(
  items: ConversationListItem[],
  sort: string,
): ConversationListItem[] {
  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;

  return [...items].sort((left, right) => {
    if (field === "status") {
      const cmp = left.status.localeCompare(right.status);
      return descending ? -cmp : cmp;
    }

    if (field === "created_at") {
      const cmp = left.created_at.localeCompare(right.created_at);
      return descending ? -cmp : cmp;
    }

    const leftTs = left.last_message_at ?? left.created_at;
    const rightTs = right.last_message_at ?? right.created_at;
    const cmp = leftTs.localeCompare(rightTs);
    return descending ? -cmp : cmp;
  });
}

export function upsertConversationListItem(
  items: ConversationListItem[],
  nextItem: ConversationListItem,
  sort: string,
): ConversationListItem[] {
  const without = items.filter((item) => item.id !== nextItem.id);
  return sortConversationItems([nextItem, ...without], sort);
}

export function conversationMatchesFilters(
  item: ConversationListItem,
  filters: {
    status?: string;
    assignment?: string;
    memberId?: string;
  },
): boolean {
  if (filters.status && item.status !== filters.status) {
    return false;
  }

  if (
    filters.assignment === "all" ||
    filters.assignment === "unassigned" ||
    filters.assignment === "assigned_to_me"
  ) {
    return conversationMatchesAssignmentFilter(
      item,
      filters.assignment,
      filters.memberId,
    );
  }

  return true;
}
