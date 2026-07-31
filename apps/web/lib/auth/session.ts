import type { JwtPayload } from "@supabase/supabase-js";

import { AUTH_ERROR_CODES } from "@/lib/auth/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";

type AmrClaim = JwtPayload["amr"];

/**
 * Returns true when verified JWT claims include Supabase's documented
 * `amr.method = "recovery"` authentication method on the current session.
 *
 * Uses `auth.getClaims()` so claims come from the validated access token,
 * not stale `user.recovery_sent_at` or unrelated AAL fields.
 *
 * @see https://supabase.com/docs/guides/auth/jwt-fields
 */
export function claimsIndicateRecoverySession(claims: JwtPayload): boolean {
  return hasRecoveryAuthenticationMethod(claims.amr);
}

function hasRecoveryAuthenticationMethod(amr: AmrClaim): boolean {
  if (!amr || !Array.isArray(amr)) {
    return false;
  }

  return amr.some((entry) => {
    if (typeof entry === "string") {
      return entry === "recovery";
    }

    return entry.method === "recovery";
  });
}

export async function getClaimsOrNull(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return null;
  }

  return data.claims;
}

export async function isRecoverySession(
  supabase: AppSupabaseClient,
): Promise<boolean> {
  const claims = await getClaimsOrNull(supabase);
  if (!claims) {
    return false;
  }

  return claimsIndicateRecoverySession(claims);
}

export async function getUser(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.auth.getUser();
  return { user: data.user, error };
}

export async function requireUser(supabase: AppSupabaseClient) {
  const { user, error } = await getUser(supabase);

  if (error || !user) {
    return {
      user: null,
      error: error ?? new Error(AUTH_ERROR_CODES.SESSION_EXPIRED),
    };
  }

  return { user, error: null };
}

export function isEmailConfirmed(
  user: NonNullable<Awaited<ReturnType<typeof getUser>>["user"]>,
): boolean {
  return Boolean(user.email_confirmed_at);
}
