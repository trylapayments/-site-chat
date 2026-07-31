import { NextResponse, type NextRequest } from "next/server";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import { resolveSafeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextPath = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `${AUTH_ROUTES.authError}?code=${encodeURIComponent("confirmation_expired")}`,
        clientEnv.NEXT_PUBLIC_APP_URL,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(
        `${AUTH_ROUTES.authError}?code=${encodeURIComponent("confirmation_expired")}`,
        clientEnv.NEXT_PUBLIC_APP_URL,
      ),
    );
  }

  const destination = resolveSafeRedirectPath(nextPath);
  return NextResponse.redirect(
    new URL(destination, clientEnv.NEXT_PUBLIC_APP_URL),
  );
}
