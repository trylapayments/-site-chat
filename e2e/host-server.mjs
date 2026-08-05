import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.E2E_HOST_PORT ?? 3001);
const hostPage = readFileSync(resolve(import.meta.dirname, "fixtures/host-page.html"), "utf8");

createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(hostPage);
}).listen(port, "0.0.0.0", () => {
  console.log(`E2E host server listening on http://localhost:${port}`);
});
