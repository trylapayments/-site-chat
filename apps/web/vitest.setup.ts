import { vi } from "vitest";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  AUTH_COOKIE_SECRET: "test-auth-cookie-secret-min-32-characters",
  WIDGET_EMBED_SECRET: "test-widget-embed-secret-min-32-characters",
  RATE_LIMIT_SECRET: "test-rate-limit-secret-min-32-characters",
  SUPABASE_JWT_SECRET: "test-supabase-jwt-secret-min-32-characters",
});
