import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { env } from "@/lib/env";

import {
  createRecoveryCookieValue,
  getRecoveryCookieClearOptions,
  getRecoveryCookieOptions,
  RECOVERY_COOKIE_NAME,
  verifyRecoveryCookieValue,
  type RecoveryCookieValidationResult,
} from "@/lib/auth/recovery-cookie";

export async function readRecoveryCookieValidation(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<RecoveryCookieValidationResult> {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;
  return verifyRecoveryCookieValue(
    rawValue,
    env.AUTH_COOKIE_SECRET,
    nowSeconds,
  );
}

export async function setRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    RECOVERY_COOKIE_NAME,
    createRecoveryCookieValue(env.AUTH_COOKIE_SECRET),
    getRecoveryCookieOptions(env.NODE_ENV === "production"),
  );
}

export async function clearRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE_NAME, "", getRecoveryCookieClearOptions());
}

export function setRecoveryCookieOnResponse(
  response: NextResponse,
): NextResponse {
  response.cookies.set(
    RECOVERY_COOKIE_NAME,
    createRecoveryCookieValue(env.AUTH_COOKIE_SECRET),
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

export async function clearRecoveryCookieIfInvalid(): Promise<void> {
  const validation = await readRecoveryCookieValidation();
  if (!validation.valid && validation.reason !== "missing") {
    await clearRecoveryCookie();
  }
}

export async function hasValidRecoveryCookie(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const validation = await readRecoveryCookieValidation(nowSeconds);
  return validation.valid;
}
