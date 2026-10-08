import { notFound } from "next/navigation";

import { requireCapability } from "@/lib/permissions/require-capability";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

/**
 * Resolve the workspace from the URL slug via the caller's membership — never
 * from a client-supplied workspace id — and assert CRM read access.
 */
export async function requireCrmWorkspace(slug: string) {
  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(slug, membership.accessible_workspaces);

  if (!guard.ok) {
    notFound();
  }

  requireCapability(guard.workspace.role, "view_contact_profile");

  return {
    workspace: guard.workspace,
    membership,
  };
}
