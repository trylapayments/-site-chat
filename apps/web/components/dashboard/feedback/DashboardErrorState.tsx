import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DashboardErrorState({
  title = "Something went wrong",
  description = "This section failed to load. Try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border/60 flex flex-col items-start gap-3 rounded-lg border border-dashed px-6 py-10",
        className,
      )}
    >
      <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md">
        <AlertCircle className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground max-w-xl text-sm">{description}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
