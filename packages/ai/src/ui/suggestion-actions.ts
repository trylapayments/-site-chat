import { sanitizePlainText } from "../safety/sanitize";

export type ComposerAcceptMode = "insert" | "replace" | "append";

export type AcceptSuggestionResult =
  | {
      ok: true;
      nextComposerText: string;
      mode: ComposerAcceptMode;
    }
  | {
      ok: false;
      reason: "empty_suggestion" | "needs_confirmation";
      suggestion: string;
    };

/**
 * Accept inserts into the composer only. Never sends a message.
 * Non-empty composer content requires explicit replace/append intent.
 */
export function acceptSuggestionIntoComposer(input: {
  suggestion: string;
  composerText: string;
  mode?: ComposerAcceptMode;
  maxLength?: number;
}): AcceptSuggestionResult {
  const suggestion = sanitizePlainText(input.suggestion, input.maxLength ?? 4000);
  if (!suggestion) {
    return { ok: false, reason: "empty_suggestion", suggestion: "" };
  }

  const current = input.composerText;
  const hasExisting = current.trim().length > 0;
  const mode = input.mode ?? (hasExisting ? undefined : "insert");

  if (hasExisting && (mode === undefined || mode === "insert")) {
    return {
      ok: false,
      reason: "needs_confirmation",
      suggestion,
    };
  }

  if (!hasExisting || mode === "replace" || mode === "insert") {
    return {
      ok: true,
      nextComposerText: suggestion,
      mode: hasExisting ? "replace" : "insert",
    };
  }

  const separator = current.endsWith("\n") ? "" : "\n\n";
  const combined = sanitizePlainText(
    `${current}${separator}${suggestion}`,
    input.maxLength ?? 4000,
  );

  return {
    ok: true,
    nextComposerText: combined,
    mode: "append",
  };
}
