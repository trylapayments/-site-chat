import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  variant?: "default" | "compact" | "inline";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border/60 flex flex-col items-start gap-3 rounded-lg border border-dashed",
        variant === "default" && "px-6 py-10",
        variant === "compact" && "px-4 py-6",
        variant === "inline" && "border-none bg-transparent px-0 py-4",
        className,
      )}
    >
      <div
        className={cn(
          "bg-muted text-muted-foreground flex items-center justify-center rounded-md",
          variant === "inline" ? "size-8" : "size-10",
        )}
      >
        <Icon
          className={variant === "inline" ? "size-4" : "size-5"}
          aria-hidden="true"
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground max-w-xl text-sm">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
