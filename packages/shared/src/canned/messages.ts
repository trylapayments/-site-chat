/**
 * English operator strings for canned responses UI.
 * Dashboard i18n is backlog; keep labels centralized.
 */
export const cannedResponsesMessagesEn = {
  pageTitle: "Canned responses",
  pageDescription:
    "Reusable reply snippets. Type / in the reply composer to insert one, or manage the library here.",
  settingsLinkLabel: "Canned responses",
  settingsLinkDescription: "Shared and personal reply snippets, folders, shortcuts and variables.",

  tabAll: "All",
  tabWorkspace: "Shared",
  tabPersonal: "Personal",
  tabFavorites: "Favorites",

  searchLabel: "Search snippets",
  searchPlaceholder: "Search title, shortcut or body…",
  searchEmpty: "No snippets match your search.",
  empty: "No canned responses yet.",
  emptyPersonal: "You have no personal snippets yet.",
  emptyFavorites: "You have not favorited any snippets yet.",
  truncated: "Only the first snippets are shown. Narrow the list with search.",
  loading: "Loading canned responses…",
  error: "Unable to load canned responses.",
  retry: "Retry",

  foldersTitle: "Folders",
  folderAll: "All snippets",
  folderNone: "Unfiled",
  folderNameLabel: "Folder name",
  folderCreate: "New folder",
  folderCreateSubmit: "Create folder",
  folderRename: "Rename",
  folderDelete: "Delete folder",
  folderDeleteHint: "Snippets inside are kept and become unfiled.",
  folderVisibilityLabel: "Folder visibility",

  createTitle: "New canned response",
  editTitle: "Edit canned response",
  create: "New snippet",
  fieldTitle: "Title",
  fieldBody: "Body",
  fieldShortcut: "Shortcut",
  fieldShortcutHint: "Optional. Typed as /shortcut in the composer.",
  fieldVisibility: "Visibility",
  fieldVisibilityWorkspace: "Shared with workspace",
  fieldVisibilityPersonal: "Personal (only you)",
  fieldVisibilityLocked: "Visibility cannot be changed after creation.",
  fieldFolder: "Folder",
  folderPlaceholder: "No folder",
  variablesTitle: "Variables",
  variablesHint: "Click to insert. Replaced when the snippet is inserted into a reply.",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  edit: "Edit",
  delete: "Delete",
  deleteConfirm: "Delete this canned response?",
  favorite: "Favorite",
  unfavorite: "Unfavorite",
  usageCount: "uses",
  badgeWorkspace: "Shared",
  badgePersonal: "Personal",
  readOnlyRow: "Read-only",
  viewerNotice: "You have read-only access to canned responses.",
  agentNotice: "Shared snippets are managed by owners and admins. You can create personal ones.",

  slashHint: "Type / to insert a canned response",
  slashEmpty: "No canned responses match",
  slashInsert: "Insert",
} as const;

export type CannedResponsesMessages = typeof cannedResponsesMessagesEn;
