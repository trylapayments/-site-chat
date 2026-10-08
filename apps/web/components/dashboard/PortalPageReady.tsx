"use client";
import { markPortalReady } from "@/lib/portal/startup";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  finishPageNavigation,
  recordDocumentReady,
  recordStartupStage,
} from "@/lib/performance/interactions";
export function PortalPageReady() {
  const pathname = usePathname();
  useEffect(() => {
    recordStartupStage("Page effect ready");
    const frame = requestAnimationFrame(() => {
      recordDocumentReady();
      markPortalReady();
      finishPageNavigation(pathname);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return null;
}
