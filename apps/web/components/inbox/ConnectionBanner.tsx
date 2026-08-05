"use client";

import type { ConnectionState } from "@site-chat/shared";

export function ConnectionBanner({
  state,
  onRetry,
}: {
  state: ConnectionState;
  onRetry?: () => void;
}) {
  if (state === "connected" || state === "connecting") {
    return null;
  }

  const messageByState: Record<
    Exclude<ConnectionState, "connected" | "connecting">,
    string
  > = {
    reconnecting: "Reconnecting to live updates...",
    disconnected: "You are offline. Live updates may be delayed.",
    failed: "Live updates unavailable.",
  };

  const message = messageByState[state];

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 text-amber-950 border-amber-200 mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <span>{message}</span>
      {state === "failed" && onRetry ? (
        <button
          type="button"
          className="font-medium underline"
          onClick={onRetry}
        >
          Retry connection
        </button>
      ) : null}
    </div>
  );
}
