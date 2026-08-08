/**
 * Canonical English dictionary shape — shared translation-key contract.
 *
 * Translator notes:
 * - agentLabel: human support agent (not AI / bot)
 * - youLabel: visitor self-reference in message meta
 * - poweredBy: keep product name "Site Chat" untranslated
 * - chatPanelLabel: accessible name for the chat panel region
 * - agentTyping: use {{name}} (agentLabel or safe display name)
 * - visitorTyping: reserved for parity / future visitor-facing copy
 * - online / offline: subtle presence; do not imply instant reply
 * - messageSent / messageDelivered / messageSeen: short receipt tick labels
 *   (aria-label / tooltip for visitor-owned messages only)
 */

export const WIDGET_MESSAGE_KEYS = [
  "launcherLabel",
  "launcherOpenLabel",
  "closeLabel",
  "composerPlaceholder",
  "sendLabel",
  "sendingLabel",
  "retryLabel",
  "reconnectingLabel",
  "offlineLabel",
  "connectionFailedLabel",
  "welcomeTitle",
  "loadError",
  "sessionError",
  "sendError",
  "poweredBy",
  "youLabel",
  "agentLabel",
  "systemLabel",
  "chatPanelLabel",
  "agentTyping",
  "visitorTyping",
  "online",
  "offline",
  "messageSent",
  "messageDelivered",
  "messageSeen",
  "attachLabel",
  "attachFilesLabel",
  "uploadProgressLabel",
  "uploadCancelLabel",
  "uploadRetryLabel",
  "uploadFailedLabel",
  "uploadCompleteLabel",
  "uploadUploadingLabel",
  "downloadLabel",
  "imagePreviewLabel",
  "imageEnlargeLabel",
  "dropFilesLabel",
  "removeAttachmentLabel",
  "attachmentTooLarge",
  "attachmentUnsupported",
] as const;

export type WidgetMessageKey = (typeof WIDGET_MESSAGE_KEYS)[number];

export type WidgetMessages = Record<WidgetMessageKey, string>;
