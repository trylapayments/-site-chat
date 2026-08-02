import { Users } from "lucide-react";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function ContactsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Contacts"
        description="Track visitors and customers who have interacted with your workspace."
      />
      <EmptyState
        icon={Users}
        title="No contacts yet"
        description="Contacts will be created automatically when visitors identify themselves during chat."
      />
    </div>
  );
}
