import { DashboardSectionSkeleton } from "@/components/dashboard/feedback/DashboardSectionSkeleton";
import { DashboardPage } from "@/components/dashboard/layout/DashboardPage";
import { DashboardPageHeader } from "@/components/dashboard/layout/DashboardPageHeader";

export default function ConversationDetailLoadingPage() {
  return (
    <DashboardPage size="full">
      <DashboardPageHeader
        title="Conversation"
        description="Loading conversation..."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <DashboardSectionSkeleton rows={6} />
        <DashboardSectionSkeleton rows={4} />
      </div>
    </DashboardPage>
  );
}
