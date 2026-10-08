import { notFound } from "next/navigation";

import { requireCapability } from "@/lib/permissions/require-capability";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

/**
 * Resolve the workspace from the URL slug via the caller's membership — never
 * from a client-supplied workspace id — and assert the weakest canned-response
 * gate. Stronger gates (use / manage) are asserted per operation.
 */
export async function requireCannedWorkspace(slug: string) {
  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(slug, membership.accessible_workspaces);

  if (!guard.ok) {
    notFound();
  }

  requireCapability(guard.workspace.role, "view_canned_responses");

  return {
    workspace: guard.workspace,
    membership,
  };
}
