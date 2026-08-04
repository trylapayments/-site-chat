import { DataTableSkeleton } from "@/components/dashboard/feedback/DataTableSkeleton";
import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";
import { DashboardPageToolbar } from "@/components/dashboard/layout/DashboardPageToolbar";

export default function InboxLoadingPage() {
  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Inbox"
        description="Review and respond to customer conversations from one place."
      />
      <DashboardPageToolbar>
        <div className="bg-muted h-9 w-full max-w-sm animate-pulse rounded-md" />
      </DashboardPageToolbar>
      <DataTableSkeleton rows={8} columns={5} />
    </DashboardPage>
  );
}
