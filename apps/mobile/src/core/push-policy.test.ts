import test from "node:test";
import assert from "node:assert/strict";
import { pushPolicy, visitorPushDestination } from "./outbox.ts";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const data = { workspaceId, conversationId, recipientUserId: "operator" };
const context = {
  userId: "operator",
  workspaceIds: [workspaceId],
  activeChat: null,
};
test("foreground alerts are suppressed for the open chat but retain navigation", () => {
  assert.deepEqual(
    pushPolicy(data, {
      ...context,
      activeChat: { workspaceId, conversationId },
    }),
    {
      target: { workspaceId, conversationId },
      show: false,
    },
  );
  assert.equal(pushPolicy(data, context).show, true);
});
test("old-account and inaccessible workspace pushes never show or navigate", () => {
  for (const state of [
    { ...context, userId: null },
    { ...context, userId: "another" },
    { ...context, workspaceIds: [] },
  ])
    assert.deepEqual(pushPolicy(data, state), { target: null, show: false });
});
test("malformed and missing recipient payloads fail closed", () => {
  for (const payload of [
    null,
    {},
    { workspaceId, conversationId },
    { ...data, conversationId: "bad" },
  ])
    assert.deepEqual(pushPolicy(payload, context), {
      target: null,
      show: false,
    });
});

test("visitor pushes require the current recipient, valid visitor and accessible workspace", () => {
  const visitor = {
    screen: "visitors",
    workspaceId,
    visitorId: conversationId,
    recipientUserId: "operator",
  };
  assert.deepEqual(visitorPushDestination(visitor, context), {
    workspaceId,
    visitorId: conversationId,
  });
  for (const payload of [
    null,
    {},
    { ...visitor, visitorId: "bad" },
    { ...visitor, screen: "chat" },
    { ...visitor, recipientUserId: "other" },
  ])
    assert.equal(visitorPushDestination(payload, context), null);
  assert.equal(visitorPushDestination(visitor, { ...context, workspaceIds: [] }), null);
  assert.equal(visitorPushDestination(visitor, { ...context, userId: null }), null);
});
