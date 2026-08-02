import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function InboxPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Inbox"
        description="Review and respond to customer conversations from one place."
      />
      <EmptyState
        icon={Inbox}
        title="No conversations yet"
        description="Visitor messages will appear here once the chat widget and messaging features are enabled."
      />
    </div>
  );
}
