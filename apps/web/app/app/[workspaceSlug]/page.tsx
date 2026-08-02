import { LayoutDashboard } from "lucide-react";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function WorkspaceHomePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Your workspace home. Product areas like Inbox, Contacts, Team, and Settings are ready for upcoming features."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Workspace is ready"
        description="Install the chat widget and invite teammates when those features arrive. For now, use the sidebar to explore each area."
      />
    </div>
  );
}
