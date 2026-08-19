import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DEMO_HOST_PORT ?? process.env.E2E_HOST_PORT ?? 3001);
const hostPage = readFileSync(resolve(__dirname, "host-page.html"), "utf8");

createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(hostPage);
}).listen(port, "0.0.0.0", () => {
  console.log(`Demo host listening on http://localhost:${port}`);
});
