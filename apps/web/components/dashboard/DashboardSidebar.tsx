import { DashboardNav } from "@/components/dashboard/DashboardNav";

export function DashboardSidebar({
  workspaceName,
  slug,
  workspaceId,
  memberId,
}: {
  workspaceName: string;
  slug: string;
  workspaceId: string;
  memberId: string;
}) {
  return (
    <aside className="border-border hidden w-60 shrink-0 border-r lg:flex lg:flex-col">
      <div className="border-border border-b px-4 py-5">
        <p className="truncate text-sm font-semibold">{workspaceName}</p>
        <p className="text-muted-foreground truncate text-xs">/app/{slug}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <DashboardNav
          slug={slug}
          workspaceId={workspaceId}
          memberId={memberId}
        />
      </div>
    </aside>
  );
}
