/**
 * English operator strings for internal notes UI.
 * Dashboard i18n is backlog; keep labels centralized.
 */
export const internalNotesMessagesEn = {
  tabMessages: "Messages",
  tabNotes: "Internal Notes",
  sectionTitle: "Internal Notes",
  empty: "No internal notes yet.",
  loading: "Loading notes…",
  error: "Unable to load notes.",
  retry: "Retry",
  composerPlaceholder: "Write internal note…",
  send: "Add note",
  saving: "Saving…",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  deleted: "Note deleted",
  mentionHint: "Type @ to mention a teammate",
  mentionEmpty: "No teammates match",
  viewerDenied: "Viewers cannot access internal notes.",
  privateBadge: "Internal",
} as const;

export type InternalNotesMessages = typeof internalNotesMessagesEn;
