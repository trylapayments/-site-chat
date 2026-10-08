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
  // Overwrite any client-supplied hint; the layout uses this only to start
  // authorized data for the actual first screen in parallel with shell rendering.
  request.headers.set("x-mill-portal-path", request.nextUrl.pathname);
  request.headers.set("x-mill-startup-profile", request.nextUrl.searchParams.get("millPerf") === "1" ? "1" : "0");
  const { supabase, response } = createMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectPath = resolveMiddlewareRedirect(
    request.nextUrl.pathname,
    Boolean(user),
    request.nextUrl.searchParams.get("next"),
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
