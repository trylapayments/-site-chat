import { NextResponse, type NextRequest } from "next/server";

import { verifyRecoveryCleanupToken } from "@/lib/auth/recovery-cleanup-token";
import { clearRecoveryCookieOnResponse } from "@/lib/auth/recovery-cookie.server";
import { sanitizeRecoveryClearDestination } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { clientEnv, env } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const tokenVerification = verifyRecoveryCleanupToken(
    token,
    env.AUTH_COOKIE_SECRET,
  );

  if (!tokenVerification.valid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const destination =
    sanitizeRecoveryClearDestination(tokenVerification.destination) ??
    sanitizeRecoveryClearDestination(searchParams.get("destination"));

  if (!destination) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (tokenVerification.signOut) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  const response = NextResponse.redirect(
    new URL(destination, clientEnv.NEXT_PUBLIC_APP_URL),
  );

  return clearRecoveryCookieOnResponse(response);
}
