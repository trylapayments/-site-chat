import { NextResponse, type NextRequest } from "next/server";

import { validateInvitationSchema } from "@site-chat/shared";

import { setInviteCookieOnResponse } from "@/lib/auth/invite-cookie.server";
import { AUTH_ROUTES } from "@/lib/auth/constants";
import { validateWorkspaceInvitation } from "@/lib/workspace/queries";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;

  if (!token || token.trim().length === 0) {
    return NextResponse.redirect(
      new URL(
        `${AUTH_ROUTES.authError}?code=invite_invalid`,
        clientEnv.NEXT_PUBLIC_APP_URL,
      ),
    );
  }

  const supabase = await createClient();
  const data = await validateWorkspaceInvitation(supabase, token);
  const parsed = validateInvitationSchema.safeParse(data);

  if (!parsed.success || !parsed.data.valid) {
    return NextResponse.redirect(
      new URL(
        `${AUTH_ROUTES.authError}?code=invite_invalid`,
        clientEnv.NEXT_PUBLIC_APP_URL,
      ),
    );
  }

  const response = NextResponse.redirect(
    new URL("/invite/pending", clientEnv.NEXT_PUBLIC_APP_URL),
  );

  return setInviteCookieOnResponse(response, token);
}
