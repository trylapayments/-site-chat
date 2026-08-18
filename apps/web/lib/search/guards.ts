import { notFound } from "next/navigation";

import { requireCapability } from "@/lib/permissions/require-capability";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

export async function requireSearchWorkspace(slug: string) {
  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(slug, membership.accessible_workspaces);

  if (!guard.ok) {
    notFound();
  }

  // Global search is an operator surface; membership + conversations capability.
  requireCapability(guard.workspace.role, "view_conversations");

  return {
    workspace: guard.workspace,
    membership,
  };
}
