import { cache } from "react";
import { redirect } from "next/navigation";

import { buildInviteClearUrl } from "@/lib/auth/invite-clear.server";
import { readInviteCookieValidation } from "@/lib/auth/invite-cookie.server";
import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  buildInvitationSuccessDestination,
  resolvePostAuthRedirect,
} from "@/lib/auth/post-auth-redirect";
import { hasValidRecoveryCookie } from "@/lib/auth/recovery-cookie.server";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { acceptInvitationForUser } from "@/lib/workspace/invitation.server";
import {
  fetchAccessibleWorkspaces,
  fetchLastWorkspaceId,
} from "@/lib/workspace/queries";
import { createClient } from "@/lib/supabase/server";

const INVITE_INVALID_DESTINATION = `${AUTH_ROUTES.authError}?code=invite_invalid`;

export const getWorkspaceContext = cache(async () => {
  const supabase = await createClient();
  const membership = await fetchAccessibleWorkspaces(supabase);
  const lastWorkspaceId = await fetchLastWorkspaceId(supabase);
  return { membership, lastWorkspaceId };
});

export async function resolveAuthenticatedDestination(
  nextPath?: string | null,
): Promise<string> {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    return "/login";
  }

  const recoveryActive = await hasValidRecoveryCookie(supabase);
  const inviteCookie = await readInviteCookieValidation();
  const { membership, lastWorkspaceId } = await getWorkspaceContext();

  const decision = resolvePostAuthRedirect({
    nextPath,
    recoveryActive,
    inviteCookie,
    isAuthenticated: true,
    membership,
    lastWorkspaceId,
  });

  if (decision.action === "accept_invitation") {
    const result = await acceptInvitationForUser(decision.token);

    if (!result.ok) {
      if (result.reason === "email_mismatch") {
        return "/invite/pending?error=email_mismatch";
      }

      return buildInviteClearUrl(INVITE_INVALID_DESTINATION);
    }

    return buildInviteClearUrl(
      buildInvitationSuccessDestination({
        status: "accepted",
        member_id: "",
        workspace_id: "",
        slug: result.slug,
      }),
    );
  }

  return decision.destination;
}

export async function redirectAuthenticatedUser(
  nextPath?: string | null,
): Promise<never> {
  const destination = await resolveAuthenticatedDestination(nextPath);
  redirect(toAppRoute(destination));
}
