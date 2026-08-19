import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DEMO_HOST_PORT ?? process.env.E2E_HOST_PORT ?? 3001);
const appOrigin = (
  process.env.DEMO_APP_ORIGIN ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
const widgetKey = process.env.DEMO_WIDGET_PUBLIC_KEY ?? "wk_e2e00000000000000000000000000001";

const hostPageTemplate = readFileSync(resolve(__dirname, "host-page.html"), "utf8");

function renderHostPage() {
  return hostPageTemplate
    .replaceAll("__DEMO_WIDGET_KEY__", widgetKey)
    .replaceAll("__DEMO_APP_ORIGIN__", appOrigin);
}

const PROXY_PREFIXES = ["/widget", "/api/v1/widget"];

function shouldProxy(pathname) {
  return PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function proxyToApp(request, response, targetUrl) {
  const headers = new Headers();
  for (const name of [
    "accept",
    "accept-language",
    "content-type",
    "if-none-match",
    "if-modified-since",
    "range",
    "origin",
    "referer",
    "user-agent",
  ]) {
    const value = request.headers[name];
    if (value) headers.set(name, value);
  }

  // Preserve the demo-site Origin so bootstrap allowlisting sees localhost:3001.
  if (!headers.has("origin") && request.headers.host) {
    headers.set("origin", `http://${request.headers.host}`);
  }

  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream unreachable";
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      `Demo proxy could not reach ${targetUrl}\n${message}\n\nStart the Next app: pnpm dev\n`,
    );
    return;
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    responseHeaders[key] = value;
  });

  response.writeHead(upstream.status, responseHeaders);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  response.end(buffer);
}

async function checkAppHealth() {
  try {
    const loader = await fetch(`${appOrigin}/widget/loader.js`, {
      method: "GET",
      redirect: "manual",
    });
    return {
      ok: loader.ok,
      status: loader.status,
      appOrigin,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      appOrigin,
      error: error instanceof Error ? error.message : "unreachable",
    };
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/demo-health") {
    const health = await checkAppHealth();
    response.writeHead(health.ok ? 200 : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ ...health, widgetKey }, null, 2));
    return;
  }

  if (shouldProxy(pathname)) {
    const targetUrl = `${appOrigin}${pathname}${url.search}`;
    await proxyToApp(request, response, targetUrl);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(renderHostPage());
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "0.0.0.0", async () => {
  console.log(`Demo host listening on http://localhost:${port}`);
  console.log(`Proxying /widget/* and /api/v1/widget/* → ${appOrigin}`);
  console.log(`Widget public key: ${widgetKey}`);

  const health = await checkAppHealth();
  if (!health.ok) {
    console.error("");
    console.error("WARNING: Next app is not reachable at", appOrigin);
    console.error("  The chat launcher will not appear until you start it:");
    console.error("    pnpm demo:prepare   # once, after supabase db reset");
    console.error("    pnpm local:refresh");
    console.error("    pnpm dev");
    console.error("  Then reload http://localhost:" + String(port));
    console.error("");
  } else {
    console.log(`Next app OK (${appOrigin}/widget/loader.js → HTTP ${String(health.status)})`);
  }

  // Helpful when public widget assets are missing from a fresh clone.
  const loaderPath = resolve(__dirname, "../apps/web/public/widget/loader.js");
  if (!existsSync(loaderPath)) {
    console.error(
      "WARNING: apps/web/public/widget/loader.js is missing. Run: pnpm --filter @site-chat/widget build",
    );
  }
});
