import { describe, expect, it } from "vitest";

import type { InviteCookieValidationResult } from "@/lib/auth/invite-cookie";
import {
  resolveAuthorizedSafeNextPath,
  resolvePostAuthRedirect,
} from "@/lib/auth/post-auth-redirect";

const membership = {
  total_membership_count: 1,
  accessible_workspaces: [
    {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      slug: "acme",
      name: "Acme",
      role: "owner" as const,
    },
  ],
};

const missingInviteCookie: InviteCookieValidationResult = {
  valid: false,
  reason: "missing",
};

describe("resolvePostAuthRedirect", () => {
  it("prioritizes recovery over invitation and workspace resolver", () => {
    const result = resolvePostAuthRedirect({
      nextPath: "/app/acme",
      recoveryActive: true,
      inviteCookie: {
        valid: true,
        payload: {
          purpose: "workspace_invitation",
          issued_at: 1,
          expires_at: 9999999999,
          invitation_token: "token",
        },
      },
      isAuthenticated: true,
      membership,
      lastWorkspaceId: null,
    });

    expect(result).toEqual({
      action: "redirect",
      destination: "/reset-password",
    });
  });

  it("accepts invitation when authenticated", () => {
    const result = resolvePostAuthRedirect({
      recoveryActive: false,
      inviteCookie: {
        valid: true,
        payload: {
          purpose: "workspace_invitation",
          issued_at: 1,
          expires_at: 9999999999,
          invitation_token: "token",
        },
      },
      isAuthenticated: true,
      membership,
      lastWorkspaceId: null,
    });

    expect(result).toEqual({ action: "accept_invitation", token: "token" });
  });

  it("preserves invitation flow via /app when unauthenticated", () => {
    const result = resolvePostAuthRedirect({
      recoveryActive: false,
      inviteCookie: {
        valid: true,
        payload: {
          purpose: "workspace_invitation",
          issued_at: 1,
          expires_at: 9999999999,
          invitation_token: "token",
        },
      },
      isAuthenticated: false,
      membership,
      lastWorkspaceId: null,
    });

    expect(result).toEqual({ action: "redirect", destination: "/app" });
  });

  it("uses authorized safe next before workspace resolver", () => {
    const result = resolvePostAuthRedirect({
      nextPath: "/app/acme/inbox",
      recoveryActive: false,
      inviteCookie: missingInviteCookie,
      isAuthenticated: true,
      membership,
      lastWorkspaceId: null,
    });

    expect(result).toEqual({
      action: "redirect",
      destination: "/app/acme/inbox",
    });
  });

  it("falls back to workspace resolver when safe next is foreign", () => {
    const result = resolvePostAuthRedirect({
      nextPath: "/app/other",
      recoveryActive: false,
      inviteCookie: missingInviteCookie,
      isAuthenticated: true,
      membership,
      lastWorkspaceId: null,
    });

    expect(result).toEqual({ action: "redirect", destination: "/app/acme" });
  });
});

describe("resolveAuthorizedSafeNextPath", () => {
  it("rejects foreign workspace slugs", () => {
    expect(resolveAuthorizedSafeNextPath("/app/other", membership)).toBeNull();
    expect(resolveAuthorizedSafeNextPath("/app/acme", membership)).toBe(
      "/app/acme",
    );
  });
});
