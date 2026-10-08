import type { Database } from "@site-chat/shared";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env.server";

/**
 * Supabase client with service role key.
 * Bypasses RLS — use only in trusted server context after explicit authorization.
 * NEVER import this module from client components.
 */
export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
