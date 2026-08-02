import type { ListAccessibleWorkspacesResult } from "@site-chat/shared";

export type MembershipState = "onboarding" | "single" | "multi" | "unavailable";

export type MembershipClassification = {
  state: MembershipState;
  accessibleWorkspaces: ListAccessibleWorkspacesResult["accessible_workspaces"];
  totalMembershipCount: number;
  lastWorkspaceId: string | null;
  selectedSlug: string | null;
};

const SYSTEM_APP_PATHS = new Set([
  "/app/onboarding",
  "/app/unavailable",
  "/app/select-workspace",
]);

export function classifyMembershipState(input: {
  membership: ListAccessibleWorkspacesResult;
  lastWorkspaceId: string | null;
}): MembershipClassification {
  const { membership, lastWorkspaceId } = input;
  const { total_membership_count, accessible_workspaces } = membership;

  if (total_membership_count === 0) {
    return {
      state: "onboarding",
      accessibleWorkspaces: accessible_workspaces,
      totalMembershipCount: total_membership_count,
      lastWorkspaceId,
      selectedSlug: null,
    };
  }

  if (accessible_workspaces.length === 0) {
    return {
      state: "unavailable",
      accessibleWorkspaces: accessible_workspaces,
      totalMembershipCount: total_membership_count,
      lastWorkspaceId,
      selectedSlug: null,
    };
  }

  if (accessible_workspaces.length === 1) {
    return {
      state: "single",
      accessibleWorkspaces: accessible_workspaces,
      totalMembershipCount: total_membership_count,
      lastWorkspaceId,
      selectedSlug: accessible_workspaces[0]?.slug ?? null,
    };
  }

  const lastAccessible = accessible_workspaces.find(
    (workspace) => workspace.workspace_id === lastWorkspaceId,
  );

  return {
    state: "multi",
    accessibleWorkspaces: accessible_workspaces,
    totalMembershipCount: total_membership_count,
    lastWorkspaceId,
    selectedSlug: lastAccessible?.slug ?? null,
  };
}

export function resolveMembershipDestination(
  classification: MembershipClassification,
): string {
  switch (classification.state) {
    case "onboarding":
      return "/app/onboarding";
    case "unavailable":
      return "/app/unavailable";
    case "single": {
      const slug = classification.selectedSlug;
      if (!slug) {
        return "/app/select-workspace";
      }
      return `/app/${slug}`;
    }
    case "multi":
      return classification.selectedSlug
        ? `/app/${classification.selectedSlug}`
        : "/app/select-workspace";
  }
}

export function isSystemAppDestination(path: string): boolean {
  return SYSTEM_APP_PATHS.has(path);
}

export function extractWorkspaceSlugFromPath(path: string): string | null {
  if (!path.startsWith("/app/")) {
    return null;
  }

  const remainder = path.slice("/app/".length);
  const slug = remainder.split("/")[0];

  if (
    !slug ||
    slug === "onboarding" ||
    slug === "unavailable" ||
    slug === "select-workspace"
  ) {
    return null;
  }

  return slug;
}

export function isWorkspacePathAuthorized(
  path: string,
  accessibleWorkspaces: ListAccessibleWorkspacesResult["accessible_workspaces"],
): boolean {
  if (isSystemAppDestination(path)) {
    return true;
  }

  if (path === "/app") {
    return true;
  }

  const slug = extractWorkspaceSlugFromPath(path);
  if (!slug) {
    return false;
  }

  return accessibleWorkspaces.some((workspace) => workspace.slug === slug);
}
