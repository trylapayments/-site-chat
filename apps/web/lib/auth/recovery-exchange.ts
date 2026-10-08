import type { JwtPayload } from "@supabase/supabase-js";

type AmrClaim = JwtPayload["amr"];

/**
 * Returns true when verified JWT claims include Supabase's documented
 * `amr.method = "recovery"` authentication method.
 *
 * Used only at `/auth/recovery` immediately after code exchange to confirm
 * the exchanged session is a recovery session before setting `sc_recovery`.
 */
export function claimsIndicateRecoverySession(claims: JwtPayload): boolean {
  return hasRecoveryAuthenticationMethod(claims.amr);
}

export function isRecoveryExchangePermitted(
  claims: JwtPayload | null | undefined,
): claims is JwtPayload & { session_id: string } {
  if (!claims) {
    return false;
  }

  if (!claimsIndicateRecoverySession(claims)) {
    return false;
  }

  return typeof claims.session_id === "string" && claims.session_id.length > 0;
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

export async function getClaimsOrNull(supabase: {
  auth: {
    getClaims: () => Promise<{
      data: { claims: JwtPayload } | null;
      error: Error | null;
    }>;
  };
}) {
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return null;
  }

  return data.claims;
}
