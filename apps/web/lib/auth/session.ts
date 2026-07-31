import { AUTH_ERROR_CODES } from "@/lib/auth/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";

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
