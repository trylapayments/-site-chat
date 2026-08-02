import { NextResponse, type NextRequest } from "next/server";

import { validateInvitationSchema } from "@site-chat/shared";

import { setInviteCookieOnResponse } from "@/lib/auth/invite-cookie.server";
import { buildInviteClearUrl } from "@/lib/auth/invite-clear.server";
import { AUTH_ROUTES } from "@/lib/auth/constants";
import { validateWorkspaceInvitation } from "@/lib/workspace/queries";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

function redirectWithInviteCleared(destination: string): NextResponse {
  return NextResponse.redirect(
    new URL(buildInviteClearUrl(destination), clientEnv.NEXT_PUBLIC_APP_URL),
  );
}

function redirectToInviteInvalid(): NextResponse {
  return redirectWithInviteCleared(
    `${AUTH_ROUTES.authError}?code=invite_invalid`,
  );
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;

  if (!token || token.trim().length === 0) {
    return redirectToInviteInvalid();
  }

  const supabase = await createClient();
  const data = await validateWorkspaceInvitation(supabase, token);
  const parsed = validateInvitationSchema.safeParse(data);

  if (!parsed.success || !parsed.data.valid) {
    return redirectToInviteInvalid();
  }

  const response = NextResponse.redirect(
    new URL("/invite/pending", clientEnv.NEXT_PUBLIC_APP_URL),
  );

  return setInviteCookieOnResponse(response, token);
}
