import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createTransport } from "../src/core/transport.ts";

// Credentials are read from a private local file, never command-line arguments or logs.
const configPath = process.argv[2];
if (!configPath) throw new Error("Usage: node --experimental-strip-types scripts/live-smoke.mjs <private-config.json> [--write-idempotency]");
const config = JSON.parse(await readFile(configPath, "utf8"));
assert.equal(new URL(config.apiUrl).origin, "https://app.mill.chat");
assert.ok(config.session?.access_token && config.session?.user?.id, "An owner-authorized session is required");
const api = createTransport(async () => ({ data: { session: config.session }, error: null }), config.apiUrl);
const report = { timestamp: new Date().toISOString(), checks: [], passed: false };
async function check(name, action) {
  const start = performance.now();
  await action();
  report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
}
try {
  await check("unauthenticated access is denied", async () => {
    const response = await fetch(`${config.apiUrl}/api/v1/mobile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "capabilities" }) });
    assert.equal(response.status, 401);
  });
  await check("authenticated mobile API is available", async () => {
    assert.equal((await api("capabilities")).apiVersion, 1);
  });
  let workspaces;
  await check("existing account workspaces are returned", async () => {
    workspaces = (await api("workspaces")).accessible_workspaces;
    assert.ok(Array.isArray(workspaces));
    assert.ok(workspaces.some(w => w.workspace_id === config.workspaceId), "The selected workspace must belong to the signed-in account");
  });
  await check("foreign workspace access is denied", async () => {
    const foreign = randomUUID();
    assert.ok(!workspaces.some(w => w.workspace_id === foreign));
    await assert.rejects(api("conversations", foreign, { assignment: "all", page: 1, pageSize: 20 }), { status: 403 });
  });
  for (const filter of ["all", "unassigned", "assigned_to_me", "closed"]) {
    await check(`${filter} conversations load`, async () => {
      const query = filter === "closed" ? { status: "closed", page: 1, pageSize: 20 } : { assignment: filter, page: 1, pageSize: 20 };
      assert.ok(Array.isArray((await api("conversations", config.workspaceId, query)).items));
    });
  }
  if (config.conversationId) {
    await check("selected test conversation and history load", async () => {
      const [detail, history] = await Promise.all([
        api("conversation", config.workspaceId, { conversationId: config.conversationId }),
        api("messages", config.workspaceId, { conversationId: config.conversationId, query: { limit: 50 } }),
      ]);
      assert.ok(detail);
      assert.ok(Array.isArray(history.items));
    });
  }
  if (process.argv.includes("--write-idempotency")) {
    assert.ok(config.conversationId && config.allowTestMessages === true, "Explicit test-conversation authorization is required for writes");
    await check("concurrent retry persists exactly one message", async () => {
      const clientMessageId = randomUUID();
      const input = { conversationId: config.conversationId, body: "Mill mobile live-backend retry verification", clientMessageId };
      const results = await Promise.all([api("send", config.workspaceId, input), api("send", config.workspaceId, input)]);
      assert.equal(results[0].message.id, results[1].message.id);
      const history = await api("messages", config.workspaceId, { conversationId: config.conversationId, query: { limit: 50 } });
      assert.equal(history.items.filter(item => item.client_message_id === clientMessageId).length, 1);
    });
  }
  report.passed = true;
} finally {
  if (config.reportPath) await writeFile(config.reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
