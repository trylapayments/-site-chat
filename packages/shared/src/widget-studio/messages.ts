/**
 * English copy for Widget Studio dashboard UI (operator-facing).
 */

export const widgetStudioMessagesEn = {
  settingsLinkLabel: "Widget Studio",
  settingsLinkDescription:
    "Customize appearance, launcher, copy, and publish changes to your embed.",
  pageTitle: "Widget Studio",
  pageDescription:
    "Edit a draft theme with live preview. Publish when you are ready for production.",
  saveDraft: "Save draft",
  publish: "Publish",
  discardDraft: "Discard draft",
  resetDefaults: "Reset to defaults",
  applyPreset: "Apply preset",
  draftSaved: "Draft saved.",
  published: "Published to production.",
  draftDiscarded: "Draft discarded.",
  resetDone: "Draft reset to defaults.",
  forbidden: "You do not have permission to manage widget customization.",
  contrastWarningTitle: "Contrast warnings",
  sections: {
    general: "General",
    launcher: "Launcher",
    chatWindow: "Chat window",
    header: "Header",
    typography: "Typography",
    colors: "Colors",
    messages: "Messages",
    branding: "Branding",
    behavior: "Behavior",
    mobile: "Mobile",
    businessHours: "Business hours",
  },
  previewLabel: "Live preview",
  previewViewportDesktop: "Desktop",
  previewViewportTablet: "Tablet",
  previewViewportPhone: "Phone",
  dirtyBadge: "Unpublished changes",
  cleanBadge: "In sync with production",
  versionLabel: "Published version",
} as const;

export type WidgetStudioMessages = typeof widgetStudioMessagesEn;
