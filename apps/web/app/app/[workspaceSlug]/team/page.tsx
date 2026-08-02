import { UserCog } from "lucide-react";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function TeamPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Team"
        description="Manage agents and roles for this workspace."
      />
      <EmptyState
        icon={UserCog}
        title="Team management coming soon"
        description="You will be able to invite agents and manage roles here in a later release."
      />
    </div>
  );
}
