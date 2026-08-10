"use client";

import {
  acceptSuggestionIntoComposer,
  sanitizePlainText,
} from "@site-chat/ai/client";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type SuggestionState =
  | { status: "idle" }
  | { status: "generating"; draft: string }
  | { status: "generated"; draft: string }
  | { status: "error"; message: string; draft: string };

type ConfirmMode = null | "replace-or-append";

async function readSuggestedReplyStream(
  response: Response,
  onDelta: (text: string) => void,
): Promise<{ suggestion: string } | { error: string }> {
  if (!response.body) {
    return { error: "AI is temporarily unavailable." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part
        .split("\n")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith("data:"));
      if (!line) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(line.slice(5).trim()) as unknown;
      } catch {
        return { error: "The AI provider returned an invalid response." };
      }

      if (
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload
      ) {
        const event = payload as {
          type: string;
          text?: string;
          suggestion?: string;
          message?: string;
        };

        if (event.type === "delta" && typeof event.text === "string") {
          assembled += event.text;
          onDelta(assembled);
        } else if (
          event.type === "done" &&
          typeof event.suggestion === "string"
        ) {
          return { suggestion: event.suggestion };
        } else if (event.type === "error") {
          return {
            error: event.message ?? "AI is temporarily unavailable.",
          };
        }
      }
    }
  }

  if (assembled.trim()) {
    return { suggestion: assembled.trim() };
  }

  return { error: "AI is temporarily unavailable." };
}

export function SuggestedReplyPanel({
  workspaceId,
  conversationId,
  composerText,
  onInsertIntoComposer,
  enabled,
}: {
  workspaceId: string;
  conversationId: string;
  composerText: string;
  onInsertIntoComposer: (text: string) => void;
  enabled: boolean;
}) {
  const labelId = useId();
  const [state, setState] = useState<SuggestionState>({ status: "idle" });
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
    setConfirmMode(null);
  }, [conversationId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!enabled) {
    return null;
  }

  async function requestSuggestion(regenerate: boolean) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setConfirmMode(null);
    setState({ status: "generating", draft: "" });

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
          regenerateNonce: regenerate
            ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            : undefined,
        }),
        signal: controller.signal,
      });

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
        setState({ status: "error", message, draft: "" });
        return;
      }

      const result = await readSuggestedReplyStream(response, (draft) => {
        setState({ status: "generating", draft: sanitizePlainText(draft) });
      });

      if ("error" in result) {
        setState({ status: "error", message: result.error, draft: "" });
        return;
      }

      setState({
        status: "generated",
        draft: sanitizePlainText(result.suggestion),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ status: "idle" });
        return;
      }
      setState({
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

  function applyAccept(mode: "insert" | "replace" | "append") {
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
    applyAccept(composerText.trim() ? "insert" : "insert");
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
                disabled={busy}
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
                disabled={busy}
                aria-label="Dismiss suggested reply"
                data-testid="suggested-reply-dismiss"
                onClick={() => {
                  abortRef.current?.abort();
                  setConfirmMode(null);
                  setState({ status: "idle" });
                }}
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
