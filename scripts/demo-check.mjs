#!/usr/bin/env node
/**
 * Quick readiness check for the local visual demo.
 * Usage: pnpm demo:check
 *
 * Validates more than HTTP 200: proxied loader.js must be plain, decodable
 * JavaScript (no leftover Content-Encoding / gzip magic), and bootstrap must
 * return JSON with a published config version.
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

function looksLikeGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function looksLikeBrotliOrZlib(bytes) {
  // zlib/deflate often starts with 0x78; treat as compressed for this check.
  return (
    bytes.length >= 2 &&
    bytes[0] === 0x78 &&
    (bytes[1] === 0x01 || bytes[1] === 0x9c || bytes[1] === 0xda)
  );
}

/**
 * Safari fails with "cannot decode raw data" when Content-Encoding says the
 * body is compressed but the proxy already decompressed it (or vice versa).
 */
async function assertDecodableLoaderJs(response, label) {
  if (!response) {
    console.log(`FAIL ${label} → no response`);
    return false;
  }

  const encoding = response.headers.get("content-encoding");
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const contentLengthHeader = response.headers.get("content-length");

  let ok = true;

  if (encoding && encoding.toLowerCase() !== "identity") {
    console.log(
      `FAIL ${label} → unexpected Content-Encoding "${encoding}" (Safari will try to decode an already-plain body)`,
    );
    ok = false;
  } else {
    console.log(`OK  ${label} encoding → ${encoding ?? "(none)"}`);
  }

  if (looksLikeGzip(bytes) || looksLikeBrotliOrZlib(bytes)) {
    console.log(`FAIL ${label} → body still looks compressed (gzip/zlib magic bytes)`);
    ok = false;
  }

  if (contentLengthHeader && Number(contentLengthHeader) !== bytes.byteLength) {
    console.log(
      `FAIL ${label} → Content-Length ${contentLengthHeader} !== body ${bytes.byteLength}`,
    );
    ok = false;
  } else if (contentLengthHeader) {
    console.log(`OK  ${label} Content-Length → ${contentLengthHeader}`);
  }

  if (!/javascript|ecmascript|text\/plain/i.test(contentType) && contentType !== "") {
    console.log(`FAIL ${label} → unexpected Content-Type "${contentType}"`);
    ok = false;
  } else {
    console.log(`OK  ${label} Content-Type → ${contentType || "(none)"}`);
  }

  // Production loader is an IIFE bundle; require readable JS markers.
  const hasJsMarkers =
    text.includes("SiteChatLoader") ||
    text.includes("sitechat") ||
    text.includes("function") ||
    text.includes("=>");
  if (!hasJsMarkers || text.includes("\uFFFD")) {
    console.log(`FAIL ${label} → body is not decodable/valid JS (length=${bytes.byteLength})`);
    ok = false;
  } else {
    console.log(`OK  ${label} body → ${bytes.byteLength} bytes of readable JS`);
  }

  return ok;
}

async function main() {
  console.log("Demo check");
  console.log(`  demo host: ${demoOrigin}`);
  console.log(`  next app:  ${appOrigin}`);
  console.log(`  widget key:${widgetKey}`);
  console.log("");

  const health = await check("demo health", `${demoOrigin}/demo-health`);
  const proxiedLoader = await check("proxied loader", `${demoOrigin}/widget/loader.js`, {
    // Prefer identity so we observe what the demo host actually serves Safari.
    headers: { "Accept-Encoding": "gzip, deflate, br" },
  });
  const loaderBodyOk = await assertDecodableLoaderJs(proxiedLoader.response, "proxied loader body");

  const bootstrap = await check(
    "proxied bootstrap",
    `${demoOrigin}/api/v1/widget/bootstrap?key=${encodeURIComponent(widgetKey)}`,
    { headers: { Origin: demoOrigin } },
  );

  let bootstrapOk = bootstrap.ok;
  if (bootstrap.response) {
    const json = await bootstrap.response.json().catch(() => null);
    if (json?.data?.config) {
      console.log(
        `     bootstrap config version=${String(json.data.config.version ?? "?")} primary=${String(json.data.config.primaryColor ?? "?")}`,
      );
    } else {
      console.log("FAIL proxied bootstrap → missing data.config");
      console.log("     bootstrap body:", JSON.stringify(json));
      bootstrapOk = false;
    }
  }

  await check("direct app loader", `${appOrigin}/widget/loader.js`);

  if (!health.ok || !proxiedLoader.ok || !loaderBodyOk || !bootstrapOk) {
    console.log("");
    console.log("Fix: ensure supabase is running, then:");
    console.log("  supabase db reset && pnpm demo:prepare && pnpm local:refresh && pnpm dev");
    console.log("  pnpm demo:host   # restart after proxy fixes");
    process.exit(1);
  }

  console.log("");
  console.log("Ready. Open", demoOrigin, "— launcher should be bottom-right.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
