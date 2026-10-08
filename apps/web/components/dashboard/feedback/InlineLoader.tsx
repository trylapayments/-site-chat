import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function InlineLoader({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex items-center gap-2 text-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}
