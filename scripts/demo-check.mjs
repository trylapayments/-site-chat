#!/usr/bin/env node
/**
 * Quick readiness check for the local visual demo.
 * Usage: pnpm demo:check
 *
 * Validates:
 * - proxied loader.js is plain, decodable JavaScript
 * - bootstrap returns published config + embed token
 * - visitor session create + message send succeed through the proxy
 *   (catches missing Authorization / embed-token header forwarding)
 */
import { randomUUID } from "node:crypto";

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
  return (
    bytes.length >= 2 &&
    bytes[0] === 0x78 &&
    (bytes[1] === 0x01 || bytes[1] === 0x9c || bytes[1] === 0xda)
  );
}

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

async function assertVisitorMessaging(embedToken) {
  const sessionResponse = await fetch(`${demoOrigin}/api/v1/widget/session`, {
    method: "POST",
    headers: {
      Origin: demoOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      embedToken,
      locale: "en",
      pageUrl: `${demoOrigin}/`,
      pageTitle: "Demo check",
      referrer: null,
    }),
  });

  const sessionJson = await sessionResponse.json().catch(() => null);
  if (!sessionResponse.ok || !sessionJson?.data?.sessionToken) {
    console.log(
      `FAIL proxied session → HTTP ${sessionResponse.status} ${JSON.stringify(sessionJson)}`,
    );
    return false;
  }
  console.log(
    `OK  proxied session → conversation ${String(sessionJson.data.conversationId ?? "?")}`,
  );

  const sessionToken = sessionJson.data.sessionToken;
  const clientMessageId = randomUUID();
  const messageResponse = await fetch(`${demoOrigin}/api/v1/widget/messages`, {
    method: "POST",
    headers: {
      Origin: demoOrigin,
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      embedToken,
      body: "Hello from demo:check",
      clientMessageId,
      pageUrl: `${demoOrigin}/`,
      referrer: null,
    }),
  });

  const messageJson = await messageResponse.json().catch(() => null);
  if (!messageResponse.ok || !messageJson?.data?.message?.id) {
    console.log(
      `FAIL proxied message send → HTTP ${messageResponse.status} ${JSON.stringify(messageJson)}`,
    );
    console.log(
      "     Hint: demo host must forward Authorization (and X-SiteChat-Embed-Token) to Next.",
    );
    return false;
  }
  console.log(
    `OK  proxied message send → message ${String(messageJson.data.message.id)} seq=${String(messageJson.data.message.sequenceNumber ?? "?")}`,
  );

  const realtimeResponse = await fetch(`${demoOrigin}/api/v1/widget/realtime-token`, {
    method: "POST",
    headers: {
      Origin: demoOrigin,
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ embedToken }),
  });
  const realtimeJson = await realtimeResponse.json().catch(() => null);
  if (!realtimeResponse.ok || !realtimeJson?.data?.token) {
    console.log(
      `FAIL proxied realtime-token → HTTP ${realtimeResponse.status} ${JSON.stringify(realtimeJson)}`,
    );
    return false;
  }
  console.log("OK  proxied realtime-token → minted");

  return true;
}

async function main() {
  console.log("Demo check");
  console.log(`  demo host: ${demoOrigin}`);
  console.log(`  next app:  ${appOrigin}`);
  console.log(`  widget key:${widgetKey}`);
  console.log("");

  const health = await check("demo health", `${demoOrigin}/demo-health`);
  const proxiedLoader = await check("proxied loader", `${demoOrigin}/widget/loader.js`, {
    headers: { "Accept-Encoding": "gzip, deflate, br" },
  });
  const loaderBodyOk = await assertDecodableLoaderJs(proxiedLoader.response, "proxied loader body");

  const bootstrap = await check(
    "proxied bootstrap",
    `${demoOrigin}/api/v1/widget/bootstrap?key=${encodeURIComponent(widgetKey)}`,
    { headers: { Origin: demoOrigin } },
  );

  let bootstrapOk = bootstrap.ok;
  let embedToken = null;
  if (bootstrap.response) {
    const json = await bootstrap.response.json().catch(() => null);
    if (json?.data?.config && json?.data?.embedToken) {
      embedToken = json.data.embedToken;
      console.log(
        `     bootstrap config version=${String(json.data.config.version ?? "?")} primary=${String(json.data.config.primaryColor ?? "?")}`,
      );
    } else {
      console.log("FAIL proxied bootstrap → missing data.config / embedToken");
      console.log("     bootstrap body:", JSON.stringify(json));
      bootstrapOk = false;
    }
  }

  await check("direct app loader", `${appOrigin}/widget/loader.js`);

  let messagingOk = false;
  if (bootstrapOk && embedToken) {
    messagingOk = await assertVisitorMessaging(embedToken);
  }

  if (!health.ok || !proxiedLoader.ok || !loaderBodyOk || !bootstrapOk || !messagingOk) {
    console.log("");
    console.log("Fix: ensure supabase is running, then:");
    console.log("  supabase db reset && pnpm demo:prepare && pnpm local:refresh && pnpm dev");
    console.log("  pnpm demo:host   # restart after proxy fixes");
    process.exit(1);
  }

  console.log("");
  console.log("Ready. Open", demoOrigin, "— send a visitor message; it should persist.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
