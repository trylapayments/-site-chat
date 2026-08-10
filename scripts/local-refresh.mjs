import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const nextDir = resolve(root, "apps/web/.next");

function runPnpm(args) {
  const result = spawnSync("pnpm", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function refreshLocalBuildArtifacts() {
  runPnpm(["--filter", "@site-chat/shared", "build"]);
  runPnpm(["--filter", "@site-chat/ai", "build"]);
  runPnpm(["--filter", "@site-chat/widget", "build"]);

  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  refreshLocalBuildArtifacts();
}
