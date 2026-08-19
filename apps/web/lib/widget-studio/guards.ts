import { notFound } from "next/navigation";

import { requireCapability } from "@/lib/permissions/require-capability";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

/**
 * Resolve Widget Studio access from the authenticated caller's workspace list.
 * Mutations assert the stronger manage capability in their Server Action.
 */
export async function requireWidgetStudioWorkspace(slug: string) {
  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(slug, membership.accessible_workspaces);

  if (!guard.ok) {
    notFound();
  }

  requireCapability(guard.workspace.role, "view_widget_studio");

  return {
    workspace: guard.workspace,
    membership,
  };
}
