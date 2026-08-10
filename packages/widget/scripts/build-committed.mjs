#!/usr/bin/env node
/**
 * Rebuild committed apps/web/public/widget bundles using the same env
 * placeholders as .github/workflows/ci.yml so `git diff --exit-code`
 * passes in CI. Run: pnpm --filter @site-chat/widget build:committed
 */
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key-for-ci-build",
};

const result = spawnSync("pnpm", ["exec", "vite", "build"], {
  env,
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
