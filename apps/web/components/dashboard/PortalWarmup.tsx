"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toAppRoute } from "@/lib/auth/redirect";

/** Prepare the three daily work areas once per workspace, after first paint.
 * No persistent storage, polling, speculative billing or settings requests. */
export function PortalWarmup({ slug }: { slug: string }) {
  const router = useRouter();
  useEffect(() => {
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      connection?.saveData ||
      connection?.effectiveType === "2g" ||
      connection?.effectiveType === "slow-2g"
    )
      return;
    const paths = [
      `/app/${slug}`,
      `/app/${slug}/inbox`,
      `/app/${slug}/visitors`,
    ];
    const timers = paths.map((path, index) =>
      window.setTimeout(
        () => {
          if (
            document.visibilityState === "visible" &&
            window.location.pathname !== path
          ) {
            router.prefetch(toAppRoute(path));
          }
        },
        500 + index * 400,
      ),
    );
    return () => {
      timers.forEach((timer) => { window.clearTimeout(timer); });
    };
  }, [router, slug]);
  return null;
}
