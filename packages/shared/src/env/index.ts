import { z } from "zod";

/**
 * Server-side environment variables.
 * Validated at build time and runtime on the server.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Signed auth flow cookies (sc_recovery)
  AUTH_COOKIE_SECRET: z.string().min(32),

  // Widget embed token signing (HMAC)
  WIDGET_EMBED_SECRET: z.string().min(32),

  // Rate limit bucket key hashing (HMAC; never store raw IPs)
  RATE_LIMIT_SECRET: z.string().min(32),

  // Supabase JWT signing secret for scoped widget Realtime tokens
  SUPABASE_JWT_SECRET: z.string().min(32),

  // AI providers (server-only; never expose to the browser)
  OPENAI_API_KEY: z.string().min(1).optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  /**
   * Explicitly allow MockProvider in production (e.g. staging demos).
   * Defaults off; NODE_ENV=test always allows mock.
   */
  AI_ALLOW_MOCK_PROVIDER: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

/**
 * Client-side environment variables (NEXT_PUBLIC_* only).
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;
