import type { Database } from "@site-chat/shared";
import {
  createServerClient,
  type CookieMethodsServer,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env";

export type AppSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Cookie-based session management for authenticated requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(
      cookiesToSet: { name: string; value: string; options: CookieOptions }[],
    ) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      } catch {
        // setAll can be called from Server Components where cookies are read-only.
      }
    },
  };

  // createServerClient has a deprecated overload for get/set/remove cookies; we use getAll/setAll.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- CookieMethodsServer overload
  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: cookieMethods,
    },
  );
}
