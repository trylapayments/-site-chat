import { Buffer } from "node:buffer";
for (const filename of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(filename);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const release =
  process.argv.includes("--release") ||
  ["production", "testflight"].includes(process.env.EAS_BUILD_PROFILE);
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const api = process.env.EXPO_PUBLIC_API_URL;
const errors = [];
if (!url || !key || !api)
  errors.push(
    "Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_API_URL.",
  );
if (key?.startsWith("sb_secret_"))
  errors.push("A privileged Supabase key cannot be used in the mobile app.");
if (key?.split(".").length === 3) {
  try {
    if (JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role !== "anon")
      errors.push("Mobile Supabase JWT key must use anon role.");
  } catch {
    errors.push("Invalid public key.");
  }
}
for (const name of Object.keys(process.env))
  if (
    name.startsWith("EXPO_PUBLIC_") &&
    /SERVICE_ROLE|PRIVATE|SECRET|PASSWORD|CHARGEBEE|RESEND|STRIPE_SECRET|CRON|OPENAI|ANTHROPIC|AI_API_KEY/.test(name)
  )
    errors.push(`Forbidden public secret variable: ${name}`);
if (release) {
  for (const [name, value] of [
    ["Supabase", url],
    ["API", api],
  ]) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || /localhost|127\.0\.0\.1|\.local$/.test(parsed.hostname))
        errors.push(`${name} must use a reachable HTTPS release endpoint.`);
    } catch {
      errors.push(`Invalid ${name} URL.`);
    }
  }
  if (!process.env.EXPO_PUBLIC_EAS_PROJECT_ID)
    errors.push("Set the EAS project ID before release.");
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  release
    ? "Release public configuration validated."
    : "Development public configuration validated.",
);
