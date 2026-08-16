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
  // Hosted CI occasionally flakes on notes reconnect / assignment races under
  // ECONNRESET load. One retry keeps main green without masking hard failures.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Single project: previously operator-chromium duplicated every realtime spec
  // with identical Desktop Chrome settings (no storageState / baseURL difference),
  // which produced false "loginOperator waitForURL" failures on the first pass
  // while the same flows passed under widget-chromium. Keep widget-chromium as
  // the canonical runner; localization specs still guard on project.name.
  projects: [
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
