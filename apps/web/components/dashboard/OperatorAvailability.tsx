"use client";
import { useEffect, useState, useRef } from "react";
import { updateOperatorAvailability } from "@/lib/operators/actions";
import type {
  OperatorStatus,
  OperatorAvailabilitySnapshot,
} from "@/lib/operators/status";

export function OperatorAvailability({ slug }: { slug: string }) {
  const [snapshot, setSnapshot] = useState<OperatorAvailabilitySnapshot | null>(
    null,
  );
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef<OperatorAvailabilitySnapshot | null>(null);
  const revision = useRef(0);
  const mutating = useRef(false);
  const activityRevision = useRef(0);
  const dirtyActivity = useRef(false);
  useEffect(() => {
    let mounted = true;
    let refreshing = false;
    let lastRequest = 0;
    dirtyActivity.current = document.visibilityState === "visible";
    async function refresh() {
      if (refreshing || mutating.current) return;
      refreshing = true;
      lastRequest = Date.now();
      const started = revision.current;
      const activity = activityRevision.current;
      const active = dirtyActivity.current;
      try {
        const next = await updateOperatorAvailability(slug, { active });
        if (mounted && started === revision.current) {
          snapshotRef.current = next;
          setSnapshot(next);
          setError(null);
          if (activity === activityRevision.current)
            dirtyActivity.current = false;
        }
      } catch {
        if (mounted) setError("Status unavailable. Retrying…");
      } finally {
        refreshing = false;
        if (mounted && started === revision.current) setPending(false);
      }
    }
    function markActivity() {
      if (document.visibilityState !== "visible") return;
      dirtyActivity.current = true;
      activityRevision.current += 1;
      if (snapshotRef.current?.autoAway || Date.now() - lastRequest >= 10_000)
        void refresh();
    }
    function onInteraction(event: Event) {
      if (event.isTrusted) markActivity();
    }
    function onFocus() {
      markActivity();
      void refresh();
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const events = ["pointerdown", "pointermove", "keydown", "scroll"];
    for (const event of events)
      window.addEventListener(event, onInteraction, { passive: true });
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      for (const event of events)
        window.removeEventListener(event, onInteraction);
    };
  }, [slug]);

  async function save(input: {
    status?: OperatorStatus;
    idleTimeoutMinutes?: number;
  }) {
    mutating.current = true;
    revision.current += 1;
    setPending(true);
    try {
      const next = await updateOperatorAvailability(slug, {
        ...input,
        active: true,
      });
      snapshotRef.current = next;
      setSnapshot(next);
      setError(null);
    } catch {
      setError("Could not save status. Please try again.");
    } finally {
      revision.current += 1;
      mutating.current = false;
      setPending(false);
    }
  }
  const status = snapshot?.status;
  return (
    <div className="relative space-y-1">
      <label className="flex items-center gap-2 text-xs">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            backgroundColor:
              status === "available"
                ? "#22c55e"
                : status === "away"
                  ? "#f59e0b"
                  : "#94a3b8",
          }}
        />
        <select
          aria-label="Your availability"
          className="w-full rounded border bg-transparent px-2 py-1 text-sm [&_option]:bg-white [&_option]:text-slate-900"
          value={
            snapshot
              ? snapshot.autoAway
                ? "auto-away"
                : snapshot.selectedStatus
              : ""
          }
          disabled={pending || !snapshot}
          onChange={(event) => {
            void save({ status: event.target.value as OperatorStatus });
          }}
        >
          {!snapshot ? (
            <option value="" disabled>
              Loading status…
            </option>
          ) : null}
          {snapshot?.autoAway ? (
            <option value="auto-away" disabled>
              Away (automatic)
            </option>
          ) : null}
          <option value="available">Available</option>
          <option value="away">Away</option>
          <option value="offline">Offline</option>
        </select>
      </label>
      {snapshot ? (
        <details className="relative text-xs">
          <summary className="cursor-pointer">
            Auto-away:{" "}
            {snapshot.idleTimeoutMinutes === 0
              ? "off"
              : `${String(snapshot.idleTimeoutMinutes)} min`}
          </summary>
          <div className="bg-popover text-popover-foreground absolute right-0 z-40 mt-1 w-56 space-y-2 rounded-md border p-3 shadow-md">
            <label className="block">
              After inactivity
              <select
                aria-label="Auto-away after inactivity"
                className="mt-1 w-full rounded border bg-transparent px-2 py-1"
                value={snapshot.idleTimeoutMinutes}
                disabled={pending}
                onChange={(event) => {
                  void save({ idleTimeoutMinutes: Number(event.target.value) });
                }}
              >
                {[0, 1, 2, 5, 10, 15, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes === 0 ? "Never" : `${String(minutes)} minutes`}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Automatic Away clears when you return. Manual Away and Offline
              stay until you change them.
            </p>
          </div>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
