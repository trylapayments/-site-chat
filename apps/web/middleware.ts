import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { applicationHostRedirect } from "@/lib/auth/application-host";

import { resolveMiddlewareRedirect } from "@/lib/auth/redirect";
import { copyCookies, createMiddlewareClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const canonical = applicationHostRedirect(
    request.nextUrl.hostname,
    request.nextUrl.pathname,
  );
  if (canonical) {
    const destination = request.nextUrl.clone();
    destination.protocol = "https:";
    destination.hostname = canonical.hostname;
    destination.port = "";
    destination.pathname = canonical.pathname;
    return NextResponse.redirect(destination);
  }
  if (!(
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/signup" ||
    request.nextUrl.pathname === "/app" ||
    request.nextUrl.pathname.startsWith("/app/")
  ))
    return NextResponse.next();
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
  matcher: [
    "/",
    "/app/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/:path*",
    "/invite/:path*",
  ],
};
