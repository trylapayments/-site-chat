"use client";
import { PortalPageReady } from "./PortalPageReady";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
export function OverviewRefresh({
  refresh,
  pending,
}: {
  refresh: () => Promise<void>;
  pending: boolean;
}) {
  return (
    <>
      <PortalPageReady />
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          void refresh();
        }}
      >
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </>
  );
}
