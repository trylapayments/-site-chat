import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { getClaimsOrNull } from "@/lib/auth/recovery-exchange";
import { env } from "@/lib/env";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import {
  createRecoveryCookieValue,
  getRecoveryCookieClearOptions,
  getRecoveryCookieOptions,
  RECOVERY_COOKIE_NAME,
  verifyRecoveryCookieValue,
  type RecoveryCookieValidationResult,
} from "@/lib/auth/recovery-cookie";

function readRawRecoveryCookieValue(): Promise<string | undefined> {
  return cookies().then((store) => store.get(RECOVERY_COOKIE_NAME)?.value);
}

export async function readRecoveryCookieValidation(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<RecoveryCookieValidationResult> {
  const rawValue = await readRawRecoveryCookieValue();
  return verifyRecoveryCookieValue(rawValue, env.AUTH_COOKIE_SECRET, {
    nowSeconds,
  });
}

export async function readRecoveryCookieValidationForSession(
  supabase: AppSupabaseClient,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<RecoveryCookieValidationResult> {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;
  const claims = await getClaimsOrNull(supabase);
  const sessionId =
    claims && typeof claims.session_id === "string"
      ? claims.session_id
      : undefined;

  if (!rawValue) {
    return { valid: false, reason: "missing" };
  }

  if (!sessionId) {
    return { valid: false, reason: "session_mismatch" };
  }

  return verifyRecoveryCookieValue(rawValue, env.AUTH_COOKIE_SECRET, {
    nowSeconds,
    sessionId,
  });
}

export async function setRecoveryCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    RECOVERY_COOKIE_NAME,
    createRecoveryCookieValue(env.AUTH_COOKIE_SECRET, sessionId),
    getRecoveryCookieOptions(env.NODE_ENV === "production"),
  );
}

export async function clearRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE_NAME, "", getRecoveryCookieClearOptions());
}

export function setRecoveryCookieOnResponse(
  response: NextResponse,
  sessionId: string,
): NextResponse {
  response.cookies.set(
    RECOVERY_COOKIE_NAME,
    createRecoveryCookieValue(env.AUTH_COOKIE_SECRET, sessionId),
    getRecoveryCookieOptions(env.NODE_ENV === "production"),
  );
  return response;
}

export function clearRecoveryCookieOnResponse(
  response: NextResponse,
): NextResponse {
  response.cookies.set(
    RECOVERY_COOKIE_NAME,
    "",
    getRecoveryCookieClearOptions(),
  );
  return response;
}

export async function clearRecoveryCookieIfInvalid(
  supabase: AppSupabaseClient,
): Promise<void> {
  const validation = await readRecoveryCookieValidationForSession(supabase);
  if (!validation.valid && validation.reason !== "missing") {
    await clearRecoveryCookie();
  }
}

export async function hasValidRecoveryCookie(
  supabase: AppSupabaseClient,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const validation = await readRecoveryCookieValidationForSession(
    supabase,
    nowSeconds,
  );
  return validation.valid;
}
