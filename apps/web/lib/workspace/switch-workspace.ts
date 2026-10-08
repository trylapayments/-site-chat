import type { AccessibleWorkspace } from "@site-chat/shared";

import {
  extractWorkspaceSlugFromPath,
  isWorkspacePathAuthorized,
} from "@/lib/auth/membership";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import {
  buildWorkspaceSwitchDestination,
  workspaceBasePath,
} from "@/lib/dashboard/routes";

export type WorkspaceSwitchResolution =
  | {
      ok: true;
      destination: string;
      workspaceId: string;
    }
  | {
      ok: false;
      destination: "/app/unavailable" | "/app/select-workspace";
    };

export function resolveWorkspaceSwitchDestination(input: {
  workspaceId: string;
  currentPath: string | null | undefined;
  accessibleWorkspaces: AccessibleWorkspace[];
}): WorkspaceSwitchResolution {
  const selected = input.accessibleWorkspaces.find(
    (workspace) => workspace.workspace_id === input.workspaceId,
  );

  if (!selected) {
    return { ok: false, destination: "/app/unavailable" };
  }

  const sanitizedPath = sanitizeRedirectPath(input.currentPath);

  if (
    !sanitizedPath ||
    !isWorkspacePathAuthorized(sanitizedPath, input.accessibleWorkspaces)
  ) {
    return {
      ok: true,
      destination: workspaceBasePath(selected.slug),
      workspaceId: selected.workspace_id,
    };
  }

  const fromSlug = extractWorkspaceSlugFromPath(sanitizedPath);

  if (!fromSlug) {
    return {
      ok: true,
      destination: workspaceBasePath(selected.slug),
      workspaceId: selected.workspace_id,
    };
  }

  return {
    ok: true,
    destination: buildWorkspaceSwitchDestination(
      sanitizedPath,
      fromSlug,
      selected.slug,
    ),
    workspaceId: selected.workspace_id,
  };
}
