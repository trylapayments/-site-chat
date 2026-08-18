import type { NotificationItem, NotificationType } from "../schemas/notifications.js";

/**
 * Safe href for a notification deep-link within a workspace.
 * Authorization is still enforced at the destination route.
 */
export function notificationHref(
  workspaceSlug: string,
  item: Pick<
    NotificationItem,
    "type" | "conversation_id" | "resource_type" | "resource_id" | "payload"
  >,
): string | null {
  const conversationId =
    item.conversation_id ??
    item.payload.conversation_id ??
    (item.resource_type === "conversation" ? item.resource_id : null);

  if (!conversationId) {
    return null;
  }

  const base = `/app/${workspaceSlug}/inbox/${conversationId}`;

  if (item.type === "mention") {
    const noteId =
      item.payload.note_id ?? (item.resource_type === "internal_note" ? item.resource_id : null);
    if (noteId) {
      return `${base}?tab=notes&noteId=${noteId}`;
    }
    return `${base}?tab=notes`;
  }

  return base;
}

export function notificationShouldPlaySound(
  type: NotificationType,
  prefs: {
    sound_enabled: boolean;
    sound_visitor_message: boolean;
    sound_assignment: boolean;
  },
): boolean {
  if (!prefs.sound_enabled) {
    return false;
  }
  if (type === "visitor_message") {
    return prefs.sound_visitor_message;
  }
  if (type === "conversation_assigned" || type === "conversation_transferred") {
    return prefs.sound_assignment;
  }
  return false;
}

export function notificationShouldShowBrowser(
  type: NotificationType,
  prefs: {
    browser_enabled: boolean;
    browser_permission_denied_at?: string | null;
    browser_conversation_new: boolean;
    browser_visitor_message: boolean;
    browser_assignment: boolean;
    browser_mention: boolean;
  },
): boolean {
  if (!prefs.browser_enabled || prefs.browser_permission_denied_at) {
    return false;
  }
  switch (type) {
    case "conversation_new":
      return prefs.browser_conversation_new;
    case "visitor_message":
      return prefs.browser_visitor_message;
    case "conversation_assigned":
    case "conversation_transferred":
      return prefs.browser_assignment;
    case "mention":
      return prefs.browser_mention;
    default:
      return false;
  }
}

export function isNotificationUnread(item: Pick<NotificationItem, "read_at">): boolean {
  return item.read_at == null;
}

/**
 * Apply an unread-count delta with a floor of zero.
 */
export function applyUnreadDelta(current: number, delta: number): number {
  return Math.max(0, current + delta);
}
