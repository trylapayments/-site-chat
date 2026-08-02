import type { ListAccessibleWorkspacesResult } from "@site-chat/shared";

export type WorkspaceGuardResult =
  | {
      ok: true;
      workspace: ListAccessibleWorkspacesResult["accessible_workspaces"][number];
    }
  | {
      ok: false;
      reason: "not_found" | "inaccessible";
    };

export function resolveWorkspaceBySlug(
  slug: string,
  accessibleWorkspaces: ListAccessibleWorkspacesResult["accessible_workspaces"],
): WorkspaceGuardResult {
  const workspace = accessibleWorkspaces.find((item) => item.slug === slug);

  if (!workspace) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, workspace };
}
