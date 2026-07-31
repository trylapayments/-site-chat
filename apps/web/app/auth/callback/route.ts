import { NextResponse, type NextRequest } from "next/server";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  getClaimsOrNull,
  isRecoveryExchangePermitted,
} from "@/lib/auth/recovery-exchange";
import { setRecoveryCookieOnResponse } from "@/lib/auth/recovery-cookie.server";
import { resolveSafeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

function confirmationExchangeRejectedResponse() {
  return NextResponse.redirect(
    new URL(
      `${AUTH_ROUTES.authError}?code=${encodeURIComponent("confirmation_expired")}`,
      clientEnv.NEXT_PUBLIC_APP_URL,
    ),
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextPath = searchParams.get("next");

  if (!code) {
    return confirmationExchangeRejectedResponse();
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return confirmationExchangeRejectedResponse();
  }

  const claims = await getClaimsOrNull(supabase);
  if (isRecoveryExchangePermitted(claims)) {
    const response = NextResponse.redirect(
      new URL(AUTH_ROUTES.resetPassword, clientEnv.NEXT_PUBLIC_APP_URL),
    );

    return setRecoveryCookieOnResponse(response, claims.session_id);
  }

  const destination = resolveSafeRedirectPath(nextPath);
  return NextResponse.redirect(
    new URL(destination, clientEnv.NEXT_PUBLIC_APP_URL),
  );
}
