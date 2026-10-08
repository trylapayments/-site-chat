import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE_DIR = resolve(import.meta.dirname, "../../../apps/web/public/widget");
const BUNDLE_FILES = ["loader.js", "app.js"] as const;

const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "Unix home path (/home/)", regex: /\/home\// },
  { name: "macOS home path (/Users/)", regex: /\/Users\// },
  { name: "Windows drive path (C:\\)", regex: /[A-Za-z]:\\/ },
];

export function scanBundlePaths(baseDir = BUNDLE_DIR): string[] {
  const violations: string[] = [];

  for (const fileName of BUNDLE_FILES) {
    const filePath = resolve(baseDir, fileName);
    const contents = readFileSync(filePath, "utf8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(contents)) {
        violations.push(`${fileName}: contains ${pattern.name}`);
      }
    }
  }

  const loaderContents = readFileSync(resolve(baseDir, "loader.js"), "utf8");
  if (
    /^\s*import\b/m.test(loaderContents) ||
    /\bexport\b/.test(loaderContents) ||
    /\bfrom\s*["']\.\//.test(loaderContents)
  ) {
    violations.push(
      "loader.js: must be classic-script compatible (no ESM import/export). Build loader as IIFE.",
    );
  }
  if (loaderContents.length > 40_000) {
    violations.push(
      `loader.js: raw size ${String(loaderContents.length)} bytes exceeds 40KB — likely pulled @site-chat/shared/Zod into the IIFE.`,
    );
  }

  return violations;
}

export function assertBundlePathsClean(baseDir = BUNDLE_DIR): void {
  const violations = scanBundlePaths(baseDir);
  if (violations.length > 0) {
    throw new Error(`Widget bundle verification failed:\n${violations.join("\n")}`);
  }
}
