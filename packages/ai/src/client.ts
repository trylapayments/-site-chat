/**
 * Browser-safe AI helpers. Do not export provider implementations here —
 * those depend on Node APIs and server secrets.
 */
export {
  acceptSuggestionIntoComposer,
  type AcceptSuggestionResult,
  type ComposerAcceptMode,
} from "./ui/suggestion-actions";
export { escapeHtml, looksLikeHtmlPayload, sanitizePlainText } from "./safety/sanitize";
export {
  AI_CAPABILITIES,
  DEFAULT_AI_FEATURE_FLAGS,
  isCapabilityEnabled,
  resolveAIFeatureFlags,
  type AICapability,
  type AIFeatureFlags,
} from "./features/capabilities";
export { AI_ERROR_CODES, publicMessageForCode, type AIErrorCode } from "./types/errors";
