import { cn } from "@/lib/utils";
import { statusLabel } from "@/components/team/team-format";
import type { TeamMemberStatus } from "@site-chat/shared";

export function TeamStatusBadge({
  status,
}: {
  status: TeamMemberStatus | "invited";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium",
        status === "active" &&
          "border-emerald-200/80 bg-emerald-50 text-emerald-800",
        status === "invited" && "border-brand/15 bg-brand-soft text-brand",
        status === "deactivated" &&
          "border-neutral-200 bg-neutral-100 text-neutral-600",
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
