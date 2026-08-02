import { describe, expect, it } from "vitest";

import type { AccessibleWorkspace } from "@site-chat/shared";

import {
  classifyMembershipState,
  isWorkspacePathAuthorized,
  resolveMembershipDestination,
} from "@/lib/auth/membership";

const membershipFixture = {
  total_membership_count: 0,
  accessible_workspaces: [],
};

describe("classifyMembershipState", () => {
  it("classifies onboarding when there are no memberships", () => {
    const result = classifyMembershipState({
      membership: membershipFixture,
      lastWorkspaceId: null,
    });

    expect(result.state).toBe("onboarding");
    expect(resolveMembershipDestination(result)).toBe("/app/onboarding");
  });

  it("classifies unavailable when memberships exist but none accessible", () => {
    const result = classifyMembershipState({
      membership: {
        total_membership_count: 1,
        accessible_workspaces: [],
      },
      lastWorkspaceId: null,
    });

    expect(result.state).toBe("unavailable");
    expect(resolveMembershipDestination(result)).toBe("/app/unavailable");
  });

  it("classifies single workspace access", () => {
    const result = classifyMembershipState({
      membership: {
        total_membership_count: 1,
        accessible_workspaces: [
          {
            workspace_id: "00000000-0000-4000-8000-000000000001",
            slug: "acme",
            name: "Acme",
            role: "owner" as const,
          },
        ],
      },
      lastWorkspaceId: null,
    });

    expect(result.state).toBe("single");
    expect(resolveMembershipDestination(result)).toBe("/app/acme");
  });

  it("prefers last accessible workspace for multi-workspace users", () => {
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

    const withLast = classifyMembershipState({
      membership: {
        total_membership_count: 2,
        accessible_workspaces: workspaces,
      },
      lastWorkspaceId: workspaces[1]?.workspace_id ?? null,
    });

    expect(withLast.state).toBe("multi");
    expect(resolveMembershipDestination(withLast)).toBe("/app/beta");

    const withoutLast = classifyMembershipState({
      membership: {
        total_membership_count: 2,
        accessible_workspaces: workspaces,
      },
      lastWorkspaceId: null,
    });

    expect(resolveMembershipDestination(withoutLast)).toBe(
      "/app/select-workspace",
    );
  });
});

describe("isWorkspacePathAuthorized", () => {
  const accessible: AccessibleWorkspace[] = [
    {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      slug: "acme",
      name: "Acme",
      role: "owner",
    },
  ];

  it("allows system destinations", () => {
    expect(isWorkspacePathAuthorized("/app/onboarding", accessible)).toBe(true);
    expect(isWorkspacePathAuthorized("/app/select-workspace", accessible)).toBe(
      true,
    );
  });

  it("allows accessible workspace slugs only", () => {
    expect(isWorkspacePathAuthorized("/app/acme", accessible)).toBe(true);
    expect(isWorkspacePathAuthorized("/app/acme/inbox", accessible)).toBe(true);
    expect(isWorkspacePathAuthorized("/app/other", accessible)).toBe(false);
  });
});
