import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = process.cwd();

// Inherit the full parent environment (CI exports keys from `supabase status -o env`).
const webServerEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
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
