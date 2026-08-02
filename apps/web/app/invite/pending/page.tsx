import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { validateInvitationSchema } from "@site-chat/shared";

import { buildInviteClearUrl } from "@/lib/auth/invite-clear.server";
import { readInviteCookieValidation } from "@/lib/auth/invite-cookie.server";
import { AUTH_ROUTES } from "@/lib/auth/constants";
import { buildLoginUrl, toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { validateWorkspaceInvitation } from "@/lib/workspace/queries";
import { redirectAuthenticatedUser } from "@/lib/workspace/redirect.server";
import { createClient } from "@/lib/supabase/server";

const INVITE_INVALID_DESTINATION = `${AUTH_ROUTES.authError}?code=invite_invalid`;

export default async function InvitePendingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const inviteCookie = await readInviteCookieValidation();

  if (!inviteCookie.valid) {
    redirect(toAppRoute(buildInviteClearUrl(INVITE_INVALID_DESTINATION)));
  }

  const supabase = await createClient();
  const validation = validateInvitationSchema.safeParse(
    await validateWorkspaceInvitation(
      supabase,
      inviteCookie.payload.invitation_token,
    ),
  );

  if (!validation.success || !validation.data.valid) {
    redirect(toAppRoute(buildInviteClearUrl(INVITE_INVALID_DESTINATION)));
  }

  const invite = validation.data;
  const { user } = await requireUser(supabase);

  if (user && params.error !== "email_mismatch") {
    await redirectAuthenticatedUser("/app");
  }

  return (
    <AuthShell
      title={`Join ${invite.workspace_name ?? "workspace"}`}
      description={
        params.error === "email_mismatch"
          ? `Sign in with ${invite.masked_email ?? "the invited email address"} to accept this invitation.`
          : `You have been invited as ${invite.role ?? "a member"}.`
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border p-4 text-sm">
          <p>
            <span className="font-medium">Workspace:</span>{" "}
            {invite.workspace_name}
          </p>
          <p>
            <span className="font-medium">Role:</span> {invite.role}
          </p>
          <p>
            <span className="font-medium">Invited email:</span>{" "}
            {invite.masked_email}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href={toAppRoute(buildLoginUrl("/app"))}>
              Sign in to accept
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link
              href={toAppRoute(
                `${AUTH_ROUTES.signup}?next=${encodeURIComponent("/app")}`,
              )}
            >
              Create account
            </Link>
          </Button>
          <p className="text-sm">
            <AuthLink href={AUTH_ROUTES.login}>Back to sign in</AuthLink>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
