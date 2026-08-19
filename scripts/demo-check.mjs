#!/usr/bin/env node
/**
 * Quick readiness check for the local visual demo.
 * Usage: pnpm demo:check
 */
const demoOrigin = (process.env.DEMO_HOST_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");
const appOrigin = (
  process.env.DEMO_APP_ORIGIN ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
const widgetKey = process.env.DEMO_WIDGET_PUBLIC_KEY ?? "wk_e2e00000000000000000000000000001";

async function check(label, url, init) {
  try {
    const response = await fetch(url, init);
    const ok = response.ok;
    console.log(`${ok ? "OK " : "FAIL"} ${label} → HTTP ${response.status} (${url})`);
    return { ok, response };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label} → ${message} (${url})`);
    return { ok: false, response: null };
  }
}

async function main() {
  console.log("Demo check");
  console.log(`  demo host: ${demoOrigin}`);
  console.log(`  next app:  ${appOrigin}`);
  console.log(`  widget key:${widgetKey}`);
  console.log("");

  const health = await check("demo health", `${demoOrigin}/demo-health`);
  await check("proxied loader", `${demoOrigin}/widget/loader.js`);
  const bootstrap = await check(
    "proxied bootstrap",
    `${demoOrigin}/api/v1/widget/bootstrap?key=${encodeURIComponent(widgetKey)}`,
    { headers: { Origin: demoOrigin } },
  );

  if (bootstrap.response) {
    const json = await bootstrap.response.json().catch(() => null);
    if (json?.data?.config) {
      console.log(
        `     bootstrap config version=${String(json.data.config.version ?? "?")} primary=${String(json.data.config.primaryColor ?? "?")}`,
      );
    } else if (!bootstrap.ok) {
      console.log("     bootstrap body:", JSON.stringify(json));
    }
  }

  await check("direct app loader", `${appOrigin}/widget/loader.js`);

  if (!health.ok || !bootstrap.ok) {
    console.log("");
    console.log("Fix: ensure supabase is running, then:");
    console.log("  supabase db reset && pnpm demo:prepare && pnpm local:refresh && pnpm dev");
    console.log("  pnpm demo:host");
    process.exit(1);
  }

  console.log("");
  console.log("Ready. Open", demoOrigin, "— launcher should be bottom-right.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
