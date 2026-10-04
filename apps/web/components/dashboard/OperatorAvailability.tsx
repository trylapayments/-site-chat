"use client";
import { useEffect, useState, useRef } from "react";
import { syncOperatorAvailability } from "@/lib/operators/actions";
import type { OperatorStatus } from "@/lib/operators/availability";
export function OperatorAvailability({ slug }: { slug: string }) {
  const [status, setStatus] = useState<OperatorStatus>("offline");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const mutating = useRef(false);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing || mutating.current) return;
      refreshing = true;
      const started = revision.current;
      try {
        const current = await syncOperatorAvailability(slug);
        if (active && started === revision.current) {
          setStatus(current);
          setError(null);
        }
      } catch {
        if (active) setError("Status unavailable. Retrying…");
      } finally {
        refreshing = false;
        if (active && started === revision.current) setPending(false);
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [slug]);
  return (
    <div className="space-y-1">
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
          value={status}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value as OperatorStatus;
            void (async () => {
              mutating.current = true;
              revision.current += 1;
              setPending(true);
              try {
                setStatus(await syncOperatorAvailability(slug, next));
                setError(null);
              } catch {
                setError("Could not save status. Please try again.");
              } finally {
                revision.current += 1;
                mutating.current = false;
                setPending(false);
              }
            })();
          }}
        >
          <option value="available">Available</option>
          <option value="away">Away</option>
          <option value="offline">Offline</option>
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
