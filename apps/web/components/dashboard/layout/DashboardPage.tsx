import { cn } from "@/lib/utils";

export function DashboardPage({
  children,
  className,
  size = "default",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "full";
}) {
  return (
    <div
      className={cn(
        "space-y-6",
        size === "default" && "mx-auto w-full max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
