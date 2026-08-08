import { buildDashboardNavItems } from "@/lib/dashboard/navigation";

import { DashboardNavLink } from "@/components/dashboard/DashboardNavLink";

export function DashboardNav({
  slug,
  workspaceId,
  memberId,
  onNavigate,
}: {
  slug: string;
  workspaceId: string;
  memberId: string;
  onNavigate?: () => void;
}) {
  const items = buildDashboardNavItems(slug);

  return (
    <nav aria-label="Main" className="space-y-1">
      {items.map((item) => (
        <DashboardNavLink
          key={item.id}
          item={item}
          slug={slug}
          workspaceId={workspaceId}
          memberId={memberId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
