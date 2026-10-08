import { clientEnvSchema } from "@site-chat/shared/env";

/**
 * Validated client environment variables (NEXT_PUBLIC_* only).
 * Safe to import from browser/client components.
 */
function createClientEnv() {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    console.error(
      "Invalid client environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid client environment variables");
  }

  return parsed.data;
}

export const clientEnv = createClientEnv();
