#!/usr/bin/env node
/**
 * Translation completeness gate for the visitor widget.
 *
 * Fails when:
 * - a supported locale has no dictionary module
 * - a dictionary is missing keys / has unknown keys
 * - interpolation placeholders differ from English
 * - an RTL locale is incorrectly marked LTR in the shared registry
 * - known hardcoded English UI strings appear in WidgetApp render paths
 *
 * Usage: pnpm --filter @site-chat/widget i18n:check
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetRoot = join(__dirname, "..");
const localesDir = join(widgetRoot, "src/i18n/locales");
const typesPath = join(widgetRoot, "src/i18n/types.ts");
const mainPath = join(widgetRoot, "src/app/main.tsx");
const sharedLocalesPath = join(widgetRoot, "../../packages/shared/src/i18n/widget-locales.ts");

const PLACEHOLDER_RE = /\{\{\s*[\w.]+\s*\}\}|\{[\w.]+\}/g;

function extractKeysFromTypes(source) {
  const match = source.match(/WIDGET_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) {
    throw new Error("Could not parse WIDGET_MESSAGE_KEYS from types.ts");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function extractPlaceholders(value) {
  return (value.match(PLACEHOLDER_RE) ?? []).sort();
}

function parseDictionaryObject(source) {
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("Could not find dictionary object");
  }
  const body = source.slice(start + 1, end);
  /** @type {Record<string, string>} */
  const result = {};
  const entryRe = /(\w+)\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = entryRe.exec(body)) !== null) {
    result[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return result;
}

function extractLocaleCodesFromRegistry(source) {
  const codes = [...source.matchAll(/code:\s*"([^"]+)"/g)].map((m) => m[1]);
  const rtlLocales = [];
  const blocks = source.split(/\{\s*code:/).slice(1);
  for (const block of blocks) {
    const codeMatch = block.match(/^\s*"([^"]+)"/);
    const dirMatch = block.match(/direction:\s*"(ltr|rtl)"/);
    if (codeMatch && dirMatch?.[1] === "rtl") {
      rtlLocales.push(codeMatch[1]);
    }
  }
  return { codes, rtlLocales };
}

const errors = [];

const keys = extractKeysFromTypes(readFileSync(typesPath, "utf8"));
const registrySource = readFileSync(sharedLocalesPath, "utf8");
const { codes: registryCodes, rtlLocales } = extractLocaleCodesFromRegistry(registrySource);

if (registryCodes.length !== 48) {
  errors.push(`Registry expected 48 locales, found ${registryCodes.length}`);
}

const expectedRtl = ["ar", "fa", "he"];
for (const locale of expectedRtl) {
  if (!rtlLocales.includes(locale)) {
    errors.push(`RTL locale ${locale} is not marked rtl in the registry`);
  }
}
for (const locale of rtlLocales) {
  if (!expectedRtl.includes(locale)) {
    errors.push(`Unexpected RTL locale in registry: ${locale}`);
  }
}

const enPath = join(localesDir, "en.ts");
if (!existsSync(enPath)) {
  errors.push("Missing English dictionary en.ts");
  console.error(errors.join("\n"));
  process.exit(1);
}

const enDict = parseDictionaryObject(readFileSync(enPath, "utf8"));
const localeFiles = readdirSync(localesDir).filter((name) => name.endsWith(".ts"));

for (const code of registryCodes) {
  const file = `${code}.ts`;
  if (!localeFiles.includes(file)) {
    errors.push(`[${code}] missing dictionary file ${file}`);
  }
}

for (const file of localeFiles) {
  const code = file.replace(/\.ts$/, "");
  if (!registryCodes.includes(code)) {
    errors.push(`[${code}] dictionary exists but locale is not in the shared registry`);
  }

  const dict = parseDictionaryObject(readFileSync(join(localesDir, file), "utf8"));
  const dictKeys = Object.keys(dict);

  for (const key of keys) {
    if (!(key in dict)) {
      errors.push(`[${code}] missing key: ${key}`);
    }
  }
  for (const key of dictKeys) {
    if (!keys.includes(key)) {
      errors.push(`[${code}] unknown key: ${key}`);
    }
  }

  for (const key of keys) {
    if (!(key in dict) || !(key in enDict)) continue;
    const enPh = extractPlaceholders(enDict[key]).join(",");
    const locPh = extractPlaceholders(dict[key]).join(",");
    if (enPh !== locPh) {
      errors.push(
        `[${code}] placeholder mismatch for ${key}: expected "${enPh || "(none)"}" got "${locPh || "(none)"}"`,
      );
    }
  }

  if (code !== "en") {
    // Soft signal when entire dictionary equals English (excluding brand line)
    const comparableKeys = keys.filter((k) => k !== "poweredBy");
    if (comparableKeys.every((k) => dict[k] === enDict[k])) {
      errors.push(`[${code}] dictionary is identical to English (likely untranslated)`);
    }
  }
}

const mainSource = readFileSync(mainPath, "utf8");
const forbiddenLiterals = [
  '"Open chat"',
  '"Close chat"',
  '"Type your message',
  '"Send"',
  '"Sending',
  '"Retry"',
  '"Reconnecting',
  '"Unable to load chat',
  '"Message failed to send',
  '"Powered by Site Chat"',
  '"Start a conversation"',
];
for (const literal of forbiddenLiterals) {
  if (mainSource.includes(literal)) {
    errors.push(`Hardcoded UI string in main.tsx: ${literal}`);
  }
}

if (errors.length > 0) {
  console.error("i18n:check failed:\n");
  for (const error of errors) {
    console.error(` - ${error}`);
  }
  process.exit(1);
}

console.log(
  `i18n:check passed (${registryCodes.length} locales, ${keys.length} keys, RTL: ${rtlLocales.join(", ")})`,
);
