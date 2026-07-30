import { clientEnvSchema, serverEnvSchema } from "@site-chat/shared/env";

/**
 * Validated server environment variables.
 * Throws at import time if required variables are missing or invalid.
 */
function createServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Invalid server environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid server environment variables");
  }

  return parsed.data;
}

/**
 * Validated client environment variables (NEXT_PUBLIC_* only).
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

export const env = createServerEnv();
export const clientEnv = createClientEnv();
