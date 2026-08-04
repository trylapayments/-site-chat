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

if (violations.length > 0) {
  console.error(
    "Widget bundles must not embed machine-specific absolute paths:\n" + violations.join("\n"),
  );
  process.exit(1);
}

console.log("Widget bundle path scan passed.");
