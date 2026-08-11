import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleDir = resolve(__dirname, "../../../apps/web/public/widget");
const bundleFiles = ["loader.js", "app.js"];

const forbiddenPatterns = [
  { name: "Unix home path (/home/)", regex: /\/home\// },
  { name: "macOS home path (/Users/)", regex: /\/Users\// },
  { name: "Windows drive path (C:\\)", regex: /[A-Za-z]:\\/ },
];

const violations = [];

for (const fileName of bundleFiles) {
  const contents = readFileSync(resolve(bundleDir, fileName), "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.regex.test(contents)) {
      violations.push(`${fileName}: contains ${pattern.name}`);
    }
  }
}

// Host pages load loader.js as a classic <script> (no type="module").
// ESM import/export in loader.js silently fails and the widget never bootstraps.
const loaderContents = readFileSync(resolve(bundleDir, "loader.js"), "utf8");
if (
  /^\s*import\b/m.test(loaderContents) ||
  /\bexport\b/.test(loaderContents) ||
  /\bfrom\s*["']\.\//.test(loaderContents)
) {
  violations.push(
    "loader.js: must be classic-script compatible (no ESM import/export). Build loader as IIFE.",
  );
}
// Gzipped loader budget (docs/ROADMAP.md Phase 5 target: 30 KB). Soft-fail early if
// shared barrel accidentally lands in the IIFE again (~90 KB raw / ~23 KB gz).
if (loaderContents.length > 40_000) {
  violations.push(
    `loader.js: raw size ${String(loaderContents.length)} bytes exceeds 40KB — likely pulled @site-chat/shared/Zod into the IIFE.`,
  );
}

if (violations.length > 0) {
  console.error("Widget bundle verification failed:\n" + violations.join("\n"));
  process.exit(1);
}

console.log("Widget bundle path scan passed.");
