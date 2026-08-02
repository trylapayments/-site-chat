import { Settings } from "lucide-react";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Configure widget, notifications, and workspace preferences."
      />
      <EmptyState
        icon={Settings}
        title="Settings coming soon"
        description="Workspace configuration options will be available here in a later release."
      />
    </div>
  );
}
