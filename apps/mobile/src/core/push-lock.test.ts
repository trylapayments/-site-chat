import test from "node:test";
import assert from "node:assert/strict";
import { withPushRegistrationLock } from "../lib/push-lock.ts";

test("logout unregisters only after an in-flight token refresh has finished", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const registration = withPushRegistrationLock(async () => {
    events.push("register-start");
    await gate;
    events.push("register-finish");
  });
  const logout = withPushRegistrationLock(async () => {
    events.push("unregister");
  });
  await Promise.resolve();
  assert.deepEqual(events, ["register-start"]);
  finish();
  await Promise.all([registration, logout]);
  assert.deepEqual(events, ["register-start", "register-finish", "unregister"]);
});

test("a failed registration does not block logout", async () => {
  await assert.rejects(
    withPushRegistrationLock(async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(await withPushRegistrationLock(async () => "unregistered"), "unregistered");
});
