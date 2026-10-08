import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env.client";

/**
 * Supabase client for browser/client components.
 * Uses the anon key; RLS enforces access control.
 */
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
