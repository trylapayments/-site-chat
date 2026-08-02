import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { env } from "@/lib/env";

import {
  createInviteCookieValue,
  getInviteCookieClearOptions,
  getInviteCookieOptions,
  INVITE_COOKIE_NAME,
  verifyInviteCookieValue,
  type InviteCookieValidationResult,
} from "@/lib/auth/invite-cookie";

function readRawInviteCookieValue(): Promise<string | undefined> {
  return cookies().then((store) => store.get(INVITE_COOKIE_NAME)?.value);
}

export async function readInviteCookieValidation(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<InviteCookieValidationResult> {
  const rawValue = await readRawInviteCookieValue();
  return verifyInviteCookieValue(rawValue, env.AUTH_COOKIE_SECRET, {
    nowSeconds,
  });
}

export async function setInviteCookie(invitationToken: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    INVITE_COOKIE_NAME,
    createInviteCookieValue(env.AUTH_COOKIE_SECRET, invitationToken),
    getInviteCookieOptions(env.NODE_ENV === "production"),
  );
}

export async function clearInviteCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(INVITE_COOKIE_NAME, "", getInviteCookieClearOptions());
}

export function setInviteCookieOnResponse(
  response: NextResponse,
  invitationToken: string,
): NextResponse {
  response.cookies.set(
    INVITE_COOKIE_NAME,
    createInviteCookieValue(env.AUTH_COOKIE_SECRET, invitationToken),
    getInviteCookieOptions(env.NODE_ENV === "production"),
  );
  return response;
}

export function clearInviteCookieOnResponse(
  response: NextResponse,
): NextResponse {
  response.cookies.set(INVITE_COOKIE_NAME, "", getInviteCookieClearOptions());
  return response;
}
