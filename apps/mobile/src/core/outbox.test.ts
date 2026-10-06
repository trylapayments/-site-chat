import test from "node:test";
import assert from "node:assert/strict";
import {
  eligible,
  failedAttempt,
  mergeMessages,
  pushDestination,
  type PendingMessage,
} from "./outbox.ts";
const message: PendingMessage = {
  id: "stable",
  userId: "alice",
  workspaceId: "w1",
  conversationId: "c1",
  body: "Hello",
  createdAt: "",
  attempts: 0,
  nextAttempt: 0,
  state: "queued",
};
test("retry preserves identity and backs off", () => {
  const next = failedAttempt(message, 503, 100);
  assert.equal(next.id, message.id);
  assert.equal(next.nextAttempt, 2100);
  assert.equal(next.state, "queued");
});
test("revoked permissions stop automatic retries", () => {
  assert.equal(failedAttempt(message, 403, 0).state, "failed");
});
test("outbox never sends another account messages", () => {
  assert.deepEqual(eligible([message], "bob", 100), []);
});
test("failed messages require explicit retry", () => {
  assert.deepEqual(eligible([{ ...message, state: "failed" }], "alice", 100), []);
});
test("CDC catchup merges duplicates and sequence order", () => {
  const row = { id: "server-1", sequence_number: 2, client_message_id: "stable" };
  assert.deepEqual(
    mergeMessages([row], [row, { id: "server-2", sequence_number: 1 }]).map((r) => r.id),
    ["server-2", "server-1"],
  );
});
test("notification data is a UUID route, never arbitrary URL", () => {
  assert.equal(pushDestination({ workspaceId: "https://evil.example", conversationId: "1" }), null);
  assert.ok(
    pushDestination({
      workspaceId: "12345678-1234-4123-8123-123456789abc",
      conversationId: "12345678-1234-4123-8123-123456789abd",
    }),
  );
});
