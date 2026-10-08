"use client";
import { can } from "@site-chat/shared";
import {
  usePortalResource,
  usePortalWorkspace,
} from "@/components/dashboard/PortalDataProvider";
import type { ActiveVisitor } from "@/lib/visitors/actions";
import { VisitorsPanel } from "./VisitorsPanel";
export function VisitorsPage() {
  const { slug, role } = usePortalWorkspace();
  const visitors = usePortalResource<ActiveVisitor[]>("visitors", 5000);
  const settings = usePortalResource<{ invitationMessage: string }>(
    "visitor-settings",
    0,
  );
  if (!visitors.data)
    return (
      <div role="status" className="p-6">
        {visitors.error ?? "Loading visitors…"}
        {visitors.error && (
          <button
            onClick={() => {
              void visitors.refresh();
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  return (
    <VisitorsPanel
      slug={slug}
      initial={visitors.data}
      refresh={visitors.refresh}
      pollError={Boolean(visitors.error)}
      standardMessage={settings.data?.invitationMessage ?? ""}
      canSend={can(role, "send_messages") && !!settings.data}
    />
  );
}
