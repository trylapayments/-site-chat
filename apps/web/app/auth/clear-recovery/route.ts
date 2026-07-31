import { NextResponse, type NextRequest } from "next/server";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import { clearRecoveryCookieOnResponse } from "@/lib/auth/recovery-cookie.server";
import {
  resolveSafeRedirectPath,
  sanitizeRecoveryClearDestination,
} from "@/lib/auth/redirect";
import { clientEnv } from "@/lib/env";

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const destination =
    sanitizeRecoveryClearDestination(searchParams.get("destination")) ??
    resolveSafeRedirectPath(AUTH_ROUTES.app);

  const response = NextResponse.redirect(
    new URL(destination, clientEnv.NEXT_PUBLIC_APP_URL),
  );

  return clearRecoveryCookieOnResponse(response);
}
