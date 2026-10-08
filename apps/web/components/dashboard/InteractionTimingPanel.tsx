"use client";
import { useEffect, useState } from "react";
import {
  clearInteractionSamples,
  enableInteractionTiming,
  interactionSamples,
  subscribeInteractionSamples,
  type InteractionSample,
} from "@/lib/performance/interactions";

/** Explicitly opt-in, admin-only, memory-only timings; no message or customer data. */
export function InteractionTimingPanel({ permitted }: { permitted: boolean }) {
  const [visible, setVisible] = useState(false);
  const [samples, setSamples] = useState<InteractionSample[]>([]);
  useEffect(() => {
    const active =
      permitted &&
      new URLSearchParams(window.location.search).get("millPerf") === "1";
    setVisible(active);
    enableInteractionTiming(active);
    if (!active) return;
    setSamples(interactionSamples());
    const unsubscribe = subscribeInteractionSamples(() =>
      { setSamples(interactionSamples()); },
    );
    return () => {
      unsubscribe();
      enableInteractionTiming(false);
    };
  }, [permitted]);
  if (!visible) return null;
  return (
    <aside
      aria-label="Interaction timings"
      className="fixed bottom-3 right-3 z-[100] max-h-64 w-80 overflow-auto rounded-xl border bg-white p-3 text-xs shadow-lg"
    >
      <div className="flex justify-between font-semibold">
        <span>Interaction timings</span>
        <button onClick={clearInteractionSamples}>Clear</button>
      </div>
      <p className="my-2 text-neutral-500">
        This browser only. Confirmation time includes the server response.
      </p>
      {samples.length ? (
        <ol>
          {samples.slice(-10).map((sample, index) => (
            <li key={index} className="flex justify-between border-t py-1">
              <span>
                {sample.kind}
                {sample.ok ? "" : " · failed"}
              </span>
              <strong>{sample.milliseconds} ms</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p>Open a conversation to begin.</p>
      )}
    </aside>
  );
}
