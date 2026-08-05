import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = process.cwd();
const webServerEnv = {
  NODE_ENV: "development",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHQiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4tIjoMTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  SUPABASE_JWT_SECRET:
    process.env.SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long",
  AUTH_COOKIE_SECRET:
    process.env.AUTH_COOKIE_SECRET ?? "placeholder-auth-cookie-secret-for-ci-build-min-32-chars",
  WIDGET_EMBED_SECRET:
    process.env.WIDGET_EMBED_SECRET ?? "placeholder-widget-embed-secret-for-ci-build-min-32-chars",
  RATE_LIMIT_SECRET:
    process.env.RATE_LIMIT_SECRET ?? "placeholder-rate-limit-secret-for-ci-build-min-32-chars",
};

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "operator-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "widget-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: [
    {
      command: "node host-server.mjs",
      cwd: path.join(repoRoot, "e2e"),
      url: "http://localhost:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "rm -rf apps/web/.next && pnpm --filter @site-chat/web exec next dev --hostname localhost --port 3000",
      cwd: repoRoot,
      url: "http://localhost:3000/widget/loader.js",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: webServerEnv,
    },
  ],
});
