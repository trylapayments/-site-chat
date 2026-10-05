"use client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
export function OverviewRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        startTransition(() => {
          router.refresh();
        });
    }, 60000);
    return () => {
      window.clearInterval(timer);
    };
  }, [router]);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
    >
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
      Refresh
    </Button>
  );
}
