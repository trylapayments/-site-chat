import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshLocalBuildArtifacts } from "./local-refresh.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

refreshLocalBuildArtifacts();

const dev = spawn("pnpm", ["--filter", "@site-chat/web", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

dev.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  dev.kill("SIGINT");
});

process.on("SIGTERM", () => {
  dev.kill("SIGTERM");
});
