"use client";

import {
  acceptSuggestionIntoComposer,
  sanitizePlainText,
} from "@site-chat/ai/client";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { readSuggestedReplySse } from "@/lib/ai/parse-suggested-reply-sse";
import { shouldInvalidateSuggestionForVisitorMessage } from "@/lib/ai/stale-suggestion";
import {
  createSuggestionRequestGuard,
  type SuggestionRequestGuard,
} from "@/lib/ai/suggestion-request-guard";

type SuggestionState =
  | { status: "idle" }
  | { status: "generating"; draft: string }
  | { status: "generated"; draft: string }
  | { status: "error"; message: string; draft: string };

type ConfirmMode = null | "replace-or-append";

export function SuggestedReplyPanel({
  workspaceId,
  conversationId,
  composerText,
  onInsertIntoComposer,
  enabled,
  latestVisitorMessageId = null,
}: {
  workspaceId: string;
  conversationId: string;
  composerText: string;
  onInsertIntoComposer: (text: string) => void;
  enabled: boolean;
  /** When a new visitor message arrives, invalidate any displayed suggestion. */
  latestVisitorMessageId?: string | null;
}) {
  const labelId = useId();
  const [state, setState] = useState<SuggestionState>({ status: "idle" });
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const abortRef = useRef<AbortController | null>(null);
  const guardRef = useRef<SuggestionRequestGuard | null>(null);
  const visitorContextRef = useRef<string | null>(latestVisitorMessageId);
  const latestVisitorMessageIdRef = useRef(latestVisitorMessageId);
  latestVisitorMessageIdRef.current = latestVisitorMessageId;

  if (!guardRef.current) {
    guardRef.current = createSuggestionRequestGuard();
  }

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    guardRef.current?.resetConversation(conversationId);
    visitorContextRef.current = latestVisitorMessageIdRef.current;
    setState({ status: "idle" });
    setConfirmMode(null);
  }, [conversationId]);

  useEffect(() => {
    // Invalidate a displayed/generating suggestion when a newer visitor message arrives.
    const previous = visitorContextRef.current;
    if (
      !shouldInvalidateSuggestionForVisitorMessage(
        previous,
        latestVisitorMessageId,
      )
    ) {
      visitorContextRef.current = latestVisitorMessageId;
      return;
    }

    visitorContextRef.current = latestVisitorMessageId;
    abortRef.current?.abort();
    abortRef.current = null;
    guardRef.current?.invalidate();
    setConfirmMode(null);
    setState({ status: "idle" });
  }, [latestVisitorMessageId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      guardRef.current?.invalidate();
    };
  }, []);

  if (!enabled) {
    return null;
  }

  async function requestSuggestion(regenerate: boolean) {
    const guard = guardRef.current;
    if (!guard) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const token = guard.begin(conversationId);
    setConfirmMode(null);
    setState({ status: "generating", draft: "" });

    const applyIfCurrent = (next: SuggestionState) => {
      if (!guard.isCurrent(token)) {
        return;
      }
      setState(next);
    };

    try {
      const response = await fetch("/api/v1/inbox/ai/suggested-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          workspaceId,
          conversationId,
          regenerate: regenerate || undefined,
        }),
        signal: controller.signal,
      });

      if (!guard.isCurrent(token)) {
        return;
      }

      if (
        !response.ok &&
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        let message = "AI is temporarily unavailable.";
        try {
          const json = (await response.json()) as {
            error?: { message?: string };
          };
          message = json.error?.message ?? message;
        } catch {
          // ignore
        }
        applyIfCurrent({ status: "error", message, draft: "" });
        return;
      }

      const result = await readSuggestedReplySse(response, {
        signal: controller.signal,
        isCurrent: () => guard.isCurrent(token),
        onDelta: (draft) => {
          applyIfCurrent({
            status: "generating",
            draft: sanitizePlainText(draft),
          });
        },
      });

      if (!guard.isCurrent(token)) {
        return;
      }

      if (result.kind === "cancelled") {
        // Only the current request may clear generating state on cancel.
        applyIfCurrent({ status: "idle" });
        return;
      }

      if (result.kind === "error") {
        applyIfCurrent({
          status: "error",
          message: result.message,
          draft: "",
        });
        return;
      }

      applyIfCurrent({
        status: "generated",
        draft: sanitizePlainText(result.suggestion),
      });
    } catch (error) {
      if (!guard.isCurrent(token)) {
        return;
      }
      if (controller.signal.aborted) {
        applyIfCurrent({ status: "idle" });
        return;
      }
      applyIfCurrent({
        status: "error",
        message:
          error instanceof Error
            ? "AI is temporarily unavailable."
            : "AI is temporarily unavailable.",
        draft: "",
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function applyAccept(mode: "replace" | "append" | "insert") {
    if (state.status !== "generated" && state.status !== "generating") {
      return;
    }

    const result = acceptSuggestionIntoComposer({
      suggestion: state.draft,
      composerText,
      mode,
    });

    if (!result.ok) {
      if (result.reason === "needs_confirmation") {
        setConfirmMode("replace-or-append");
      }
      return;
    }

    onInsertIntoComposer(result.nextComposerText);
    setConfirmMode(null);
    setState({ status: "idle" });
  }

  function handleAccept() {
    applyAccept("insert");
  }

  function handleDismiss() {
    abortRef.current?.abort();
    abortRef.current = null;
    guardRef.current?.invalidate();
    setConfirmMode(null);
    setState({ status: "idle" });
  }

  const draft =
    state.status === "generating" ||
    state.status === "generated" ||
    state.status === "error"
      ? state.draft
      : "";

  const busy = state.status === "generating";

  return (
    <div
      className="border-border mb-3 rounded-md border p-3"
      data-testid="suggested-reply-panel"
      aria-labelledby={labelId}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p id={labelId} className="text-sm font-medium">
          Suggested reply
        </p>
        {state.status === "idle" || state.status === "error" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label="Suggest reply"
            data-testid="suggest-reply-button"
            onClick={() => {
              void requestSuggestion(false);
            }}
          >
            Suggest reply
          </Button>
        ) : null}
      </div>

      {state.status === "error" ? (
        <p
          className="text-destructive mb-2 text-sm"
          role="alert"
          data-testid="suggested-reply-error"
        >
          {state.message}
        </p>
      ) : null}

      {state.status === "generating" || state.status === "generated" ? (
        <>
          <label className="sr-only" htmlFor="suggested-reply-draft">
            Edit suggested reply
          </label>
          <textarea
            id="suggested-reply-draft"
            data-testid="suggested-reply-draft"
            value={draft}
            onChange={(event) => {
              const next = sanitizePlainText(event.target.value);
              setState({ status: "generated", draft: next });
            }}
            rows={4}
            maxLength={4000}
            disabled={busy}
            className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm"
            aria-busy={busy}
          />
          {busy ? (
            <p
              className="text-muted-foreground mt-2 text-xs"
              role="status"
              aria-live="polite"
              data-testid="suggested-reply-generating"
            >
              Generating suggestion…
            </p>
          ) : null}

          {confirmMode === "replace-or-append" ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              data-testid="suggested-reply-confirm"
              role="group"
              aria-label="Confirm how to use the suggestion"
            >
              <p className="text-muted-foreground w-full text-xs">
                Your composer already has text. Replace it or append the
                suggestion?
              </p>
              <Button
                type="button"
                size="sm"
                aria-label="Replace composer text with suggestion"
                data-testid="suggested-reply-replace"
                onClick={() => {
                  applyAccept("replace");
                }}
              >
                Replace
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Append suggestion below composer text"
                data-testid="suggested-reply-append"
                onClick={() => {
                  applyAccept("append");
                }}
              >
                Append
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Cancel suggestion insert"
                onClick={() => {
                  setConfirmMode(null);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || draft.trim().length === 0}
                aria-label="Accept suggested reply into composer"
                data-testid="suggested-reply-accept"
                onClick={handleAccept}
              >
                Accept
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Regenerate suggested reply"
                data-testid="suggested-reply-regenerate"
                onClick={() => {
                  void requestSuggestion(true);
                }}
              >
                Regenerate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Dismiss suggested reply"
                data-testid="suggested-reply-dismiss"
                onClick={handleDismiss}
              >
                Dismiss
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
