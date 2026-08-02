import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="border-border/60 flex flex-col items-start gap-3 rounded-lg border border-dashed px-6 py-10">
      <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground max-w-xl text-sm">{description}</p>
      </div>
    </div>
  );
}
