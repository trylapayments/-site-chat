export const notificationsMessagesEn = {
  bellAriaLabel: "Notifications",
  panelTitle: "Notifications",
  empty: "No notifications yet",
  markAllRead: "Mark all as read",
  markRead: "Mark as read",
  loadMore: "Load more",
  settingsLinkLabel: "Notifications",
  settingsLinkDescription: "In-app, browser, sound, and email preferences for your account.",
  unreadCountLabel: (count: number) =>
    count === 1 ? "1 unread notification" : `${String(count)} unread notifications`,
  types: {
    conversation_new: "New conversation",
    visitor_message: "Visitor message",
    conversation_assigned: "Assigned to you",
    conversation_transferred: "Transferred",
    conversation_unassigned: "Unassigned",
    mention: "Mentioned you",
    billing_payment_failed: "Billing",
    trial_ending: "Trial ending",
  },
} as const;
