import type {
  AcceptInvitationResult,
  ListAccessibleWorkspacesResult,
} from "@site-chat/shared";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import type { InviteCookieValidationResult } from "@/lib/auth/invite-cookie";
import {
  classifyMembershipState,
  isWorkspacePathAuthorized,
  resolveMembershipDestination,
} from "@/lib/auth/membership";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

export type PostAuthRedirectResult =
  | { action: "redirect"; destination: string }
  | {
      action: "accept_invitation";
      token: string;
    };

export type PostAuthRedirectInput = {
  nextPath?: string | null;
  recoveryActive: boolean;
  inviteCookie: InviteCookieValidationResult;
  isAuthenticated: boolean;
  membership: ListAccessibleWorkspacesResult;
  lastWorkspaceId: string | null;
};

export function resolveAuthorizedSafeNextPath(
  nextPath: string | null | undefined,
  membership: ListAccessibleWorkspacesResult,
): string | null {
  const sanitized = sanitizeRedirectPath(nextPath);
  if (!sanitized) {
    return null;
  }

  if (!isWorkspacePathAuthorized(sanitized, membership.accessible_workspaces)) {
    return null;
  }

  return sanitized;
}

export function resolvePostAuthRedirect(
  input: PostAuthRedirectInput,
): PostAuthRedirectResult {
  if (input.recoveryActive) {
    return { action: "redirect", destination: AUTH_ROUTES.resetPassword };
  }

  if (input.inviteCookie.valid) {
    if (input.isAuthenticated) {
      return {
        action: "accept_invitation",
        token: input.inviteCookie.payload.invitation_token,
      };
    }

    return { action: "redirect", destination: AUTH_ROUTES.app };
  }

  const safeNext = resolveAuthorizedSafeNextPath(
    input.nextPath,
    input.membership,
  );
  if (safeNext) {
    return { action: "redirect", destination: safeNext };
  }

  const classification = classifyMembershipState({
    membership: input.membership,
    lastWorkspaceId: input.lastWorkspaceId,
  });

  return {
    action: "redirect",
    destination: resolveMembershipDestination(classification),
  };
}

export function buildInvitationSuccessDestination(
  result: AcceptInvitationResult,
): string {
  return `/app/${result.slug}`;
}

export function isInvitationEmailMismatchError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Invitation email does not match authenticated user")
  );
}
