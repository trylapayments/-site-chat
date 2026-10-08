import test from "node:test";
import assert from "node:assert/strict";
import { startPolling } from "./poll.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("slow visitor requests finish before the next poll is scheduled", async () => {
  let finish!: () => void;
  let calls = 0;
  const callbacks: (() => void)[] = [];
  const stop = startPolling(
    () => {
      calls++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    3000,
    (callback, delay) => {
      assert.equal(delay, 3000);
      callbacks.push(callback);
      return () => {};
    },
  );
  await tick();
  assert.equal(calls, 1);
  assert.equal(callbacks.length, 0);
  finish();
  await tick();
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  assert.equal(calls, 2);
  stop();
  finish();
  await tick();
  assert.equal(callbacks.length, 1);
});

test("leaving the screen cancels the next visitor poll", async () => {
  let cancelled = false;
  const stop = startPolling(
    async () => {},
    3000,
    () => () => {
      cancelled = true;
    },
  );
  await tick();
  stop();
  assert.equal(cancelled, true);
});

test("a failed request still retries while the screen is open", async () => {
  let scheduled = 0;
  const stop = startPolling(
    async () => {
      throw new Error("Offline");
    },
    3000,
    () => {
      scheduled++;
      return () => {};
    },
  );
  await tick();
  assert.equal(scheduled, 1);
  stop();
});
