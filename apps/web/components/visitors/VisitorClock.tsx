"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { formatVisitorDuration } from "@/lib/visitors/duration";
const ClockContext = createContext<number | null>(null);
/** One local clock for all visitors; server polling does not drive or reset it. */
export function VisitorClock({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const epoch = Date.now();
    const origin = performance.now();
    const tick = () => {
      setNow(epoch + performance.now() - origin);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}
export function TimeOnSite({ start }: { start: string }) {
  const now = useContext(ClockContext);
  return (
    <span className="tabular-nums" data-testid="visitor-duration">
      {now === null ? "—" : formatVisitorDuration(start, now)}
    </span>
  );
}
