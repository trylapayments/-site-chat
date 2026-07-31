import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveMiddlewareRedirect } from "@/lib/auth/redirect";
import { copyCookies, createMiddlewareClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectPath = resolveMiddlewareRedirect(
    request.nextUrl.pathname,
    Boolean(user),
  );

  if (redirectPath) {
    const redirectResponse = NextResponse.redirect(
      new URL(redirectPath, request.url),
    );
    copyCookies(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/signup"],
};
