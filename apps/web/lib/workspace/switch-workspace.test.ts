import { describe, expect, it } from "vitest";

import type { AccessibleWorkspace } from "@site-chat/shared";

import { resolveWorkspaceSwitchDestination } from "@/lib/workspace/switch-workspace";

const workspaces: AccessibleWorkspace[] = [
  {
    workspace_id: "00000000-0000-4000-8000-000000000001",
    slug: "acme",
    name: "Acme",
    role: "owner",
  },
  {
    workspace_id: "00000000-0000-4000-8000-000000000002",
    slug: "beta",
    name: "Beta",
    role: "agent",
  },
];

describe("resolveWorkspaceSwitchDestination", () => {
  it("preserves safe sections for authorized paths", () => {
    const result = resolveWorkspaceSwitchDestination({
      workspaceId: workspaces[1]?.workspace_id ?? "",
      currentPath: "/app/acme/settings",
      accessibleWorkspaces: workspaces,
    });

    expect(result).toEqual({
      ok: true,
      destination: "/app/beta/settings",
      workspaceId: workspaces[1]?.workspace_id,
    });
  });

  it("rejects unknown workspace ids", () => {
    const result = resolveWorkspaceSwitchDestination({
      workspaceId: "00000000-0000-4000-8000-000000999999",
      currentPath: "/app/acme/inbox",
      accessibleWorkspaces: workspaces,
    });

    expect(result).toEqual({ ok: false, destination: "/app/unavailable" });
  });

  it("falls back when the current path is not authorized", () => {
    const result = resolveWorkspaceSwitchDestination({
      workspaceId: workspaces[1]?.workspace_id ?? "",
      currentPath: "/app/other/inbox",
      accessibleWorkspaces: workspaces,
    });

    expect(result).toEqual({
      ok: true,
      destination: "/app/beta",
      workspaceId: workspaces[1]?.workspace_id,
    });
  });

  it("falls back when the current path is missing or invalid", () => {
    expect(
      resolveWorkspaceSwitchDestination({
        workspaceId: workspaces[1]?.workspace_id ?? "",
        currentPath: "//evil.example",
        accessibleWorkspaces: workspaces,
      }),
    ).toEqual({
      ok: true,
      destination: "/app/beta",
      workspaceId: workspaces[1]?.workspace_id,
    });
  });
});
