"use client";
import { afterPortalReady } from "@/lib/portal/startup";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Suspense, useEffect } from "react";
import { workspaceConversationId } from "@/lib/portal/client-route";
import { usePortalWorkspace } from "./PortalDataProvider";
import { OverviewPage } from "./OverviewPage";
const VisitorsPage = dynamic(() =>
  import("@/components/visitors/VisitorsPage").then(
    (module) => module.VisitorsPage,
  ),
);
const InboxWorkspace = dynamic(() =>
  import("@/components/inbox/workspace/InboxWorkspace").then(
    (module) => module.InboxWorkspace,
  ),
);
export function PortalWorkArea({ children }: { children: React.ReactNode }) {
  const { slug } = usePortalWorkspace();
  const path = usePathname();
  const base = `/app/${slug}`;
  useEffect(() => {
    // Start other work areas after the first screen has rendered. No hover or
    // nonstandard browser API is required for touch navigation.
    let timers: ReturnType<typeof setTimeout>[] = [];
    const stopWaiting = afterPortalReady(() => {
      timers = [
        () => import("./OverviewPage"),
        () => import("@/components/visitors/VisitorsPage"),
        () => import("@/components/inbox/workspace/InboxWorkspace"),
      ].map((load, index) =>
        setTimeout(
          () => {
            const connection = (
              navigator as Navigator & { connection?: { saveData?: boolean } }
            ).connection;
            if (document.visibilityState === "visible" && !connection?.saveData)
              void load().catch(() => {});
          },
          1200 + index * 300,
        ),
      );
    });
    return () => {
      stopWaiting();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  let content = children;
  if (path === base) return <OverviewPage />;
  if (path === `${base}/visitors`) content = <VisitorsPage />;
  if (path === `${base}/inbox` || workspaceConversationId(path, slug))
    content = <InboxWorkspace />;
  return (
    <Suspense
      fallback={
        <div role="status" className="p-6">
          Loading workspace…
        </div>
      }
    >
      {content}
    </Suspense>
  );
}
