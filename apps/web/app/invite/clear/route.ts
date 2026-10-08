import { NextResponse, type NextRequest } from "next/server";

import { clearInviteCookieOnResponse } from "@/lib/auth/invite-cookie.server";
import { sanitizeInviteClearDestination } from "@/lib/auth/redirect";
import { clientEnv } from "@/lib/env";

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const destination = sanitizeInviteClearDestination(
    searchParams.get("destination"),
  );

  if (!destination) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const response = NextResponse.redirect(
    new URL(destination, clientEnv.NEXT_PUBLIC_APP_URL),
  );

  return clearInviteCookieOnResponse(response);
}
