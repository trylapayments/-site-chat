import test from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "./transport.ts";
const session = async () => ({
  data: { session: { user: { id: "bob" }, access_token: "test-token" } },
  error: null,
});
test("account changes cannot transmit another account queued message", async () => {
  let calls = 0;
  const api = createTransport(session, "https://example.test", async () => {
    calls++;
    return Response.json({ data: {} });
  });
  await assert.rejects(api("send", "workspace", { clientMessageId: "stable-id" }, "alice"), {
    code: "ACCOUNT_CHANGED",
  });
  assert.equal(calls, 0);
});
test("retry transport retains original UUID and authenticated account", async () => {
  let payload: string | undefined;
  const api = createTransport(session, "https://example.test", async (_url, init) => {
    payload = init?.body as string;
    return Response.json({ data: { sent: true } });
  });
  await api("send", "workspace", { clientMessageId: "stable-id", body: "Hello" }, "bob");
  assert.equal(JSON.parse(payload!).input.clientMessageId, "stable-id");
});
test("unauthenticated outbox cannot issue network requests", async () => {
  let calls = 0;
  const api = createTransport(
    async () => ({ data: { session: null }, error: null }),
    "https://example.test",
    async () => {
      calls++;
      return Response.json({});
    },
  );
  await assert.rejects(api("send", "workspace"), { status: 401 });
  assert.equal(calls, 0);
});
