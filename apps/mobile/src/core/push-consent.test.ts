import { test } from "node:test";
import assert from "node:assert/strict";
import { runPushOnboarding, startPushOnboarding } from "./push-consent.ts";
test("a historical attempted marker cannot block an unrequested iOS permission", async () => {
  const events: string[] = [];
  await runPushOnboarding({
    permission: async () => ({ undetermined: true, denied: false }),
    marker: async () => "attempted",
    register: async () => {
      events.push("request-and-register");
    },
    remember: async (state) => {
      events.push(state);
    },
    clear: async () => {
      events.push("clear");
    },
    cancelled: () => false,
  });
  assert.deepEqual(events, ["request-and-register", "registered"]);
});
test("a network failure before consent remains retryable", async () => {
  const events: string[] = [];
  await runPushOnboarding({
    permission: async () => ({ undetermined: true, denied: false }),
    marker: async () => null,
    register: async () => {
      throw new Error("Network unavailable");
    },
    remember: async (state) => {
      events.push(state);
    },
    clear: async () => {
      events.push("clear");
    },
    cancelled: () => false,
  });
  assert.deepEqual(events, ["clear"]);
});
test("a network failure after consent cannot consume registration", async () => {
  const events: string[] = [];
  await runPushOnboarding({
    permission: async () => ({ undetermined: false, denied: false }),
    marker: async () => null,
    register: async () => {
      throw new Error("Server unavailable");
    },
    remember: async (state) => {
      events.push(state);
    },
    clear: async () => {
      events.push("clear");
    },
    cancelled: () => false,
  });
  assert.deepEqual(events, ["clear"]);
});
test("an explicit denial is remembered without repeatedly prompting", async () => {
  let attempts = 0;
  await runPushOnboarding({
    permission: async () => ({ undetermined: false, denied: true }),
    marker: async () => "denied",
    register: async () => {
      attempts++;
    },
    remember: async () => {},
    clear: async () => {},
    cancelled: () => false,
  });
  assert.equal(attempts, 0);
});
test("a completed onboarding respects a later manual opt-out", async () => {
  let attempts = 0;
  await runPushOnboarding({
    permission: async () => ({ undetermined: false, denied: false }),
    marker: async () => "registered",
    register: async () => {
      attempts++;
    },
    remember: async () => {},
    clear: async () => {},
    cancelled: () => false,
  });
  assert.equal(attempts, 0);
});

test("historical attempted marker with existing Allow still registers the device", async () => {
  let registered = 0;
  const result = await runPushOnboarding({
    permission: async () => ({ undetermined: false, denied: false }),
    marker: async () => "attempted",
    register: async () => { registered++; },
    remember: async () => {}, clear: async () => {}, cancelled: () => false,
  });
  assert.equal(registered, 1);
  assert.equal(result, "registered");
});
test("permission enabled in iPhone settings after denial registers without a toggle", async () => {
  let registered = 0;
  const result = await runPushOnboarding({
    permission: async () => ({ undetermined: false, denied: false }),
    marker: async () => "denied",
    register: async () => { registered++; },
    remember: async () => {}, clear: async () => {}, cancelled: () => false,
  });
  assert.equal(registered, 1);
  assert.equal(result, "registered");
});
test("failure to inspect iPhone permission remains retryable", async () => {
  const result = await runPushOnboarding({
    permission: async () => { throw new Error("Native lookup unavailable"); },
    marker: async () => null,
    register: async () => { assert.fail("Cannot register before inspecting consent"); },
    remember: async () => { assert.fail("Cannot persist success"); },
    clear: async () => {}, cancelled: () => false,
  });
  assert.equal(result, "retry");
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test("first-launch server failure recovers while foregrounded, with one consent prompt", async () => {
  let consent = { undetermined: true, denied: false };
  let marker: string | null = null;
  let prompts = 0;
  let requests = 0;
  const timers: { callback: () => void; delay: number }[] = [];
  const stop = startPushOnboarding(() => runPushOnboarding({
    permission: async () => consent,
    marker: async () => marker,
    register: async () => {
      if (consent.undetermined) { prompts++; consent = { undetermined: false, denied: false }; }
      requests++;
      if (requests === 1) throw new Error("Server unavailable");
    },
    remember: async (state) => { marker = state; },
    clear: async () => { marker = null; }, cancelled: () => false,
  }), (callback, delay) => { timers.push({ callback, delay }); return () => {}; });
  await flush();
  assert.equal(marker, null);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);
  timers.shift()!.callback(); await flush();
  assert.equal(marker, "registered");
  assert.equal(prompts, 1);
  assert.equal(requests, 2);
  assert.equal(timers.length, 0);
  stop();
});
test("background/account cleanup cancels registration retries", async () => {
  let attempts = 0;
  let callback: (() => void) | undefined;
  let timerCancelled = false;
  const stop = startPushOnboarding(async () => { attempts++; return "retry"; }, (run) => {
    callback = run; return () => { timerCancelled = true; };
  });
  await flush(); stop(); callback!(); await flush();
  assert.equal(timerCancelled, true);
  assert.equal(attempts, 1);
});
test("permission denial never schedules repeated prompts", async () => {
  startPushOnboarding(async () => "denied", () => { assert.fail("Denied must not retry"); });
  await flush();
});
test("slow registration never overlaps retries and backoff is capped", async () => {
  let resolve: (value: "retry") => void = () => {};
  let attempts = 0;
  const timers: {callback: () => void; delay: number}[] = [];
  const stop = startPushOnboarding(() => { attempts++; return new Promise(r => { resolve = r; }); }, (callback, delay) => {
    timers.push({callback,delay}); return () => {};
  });
  await flush(); assert.equal(timers.length, 0); assert.equal(attempts, 1);
  const delays: number[] = [];
  for (let n=0;n<5;n++) { resolve("retry"); await flush(); const t=timers.shift()!; delays.push(t.delay); t.callback(); await flush(); }
  assert.deepEqual(delays, [5000,10000,20000,30000,30000]);
  assert.equal(attempts, 6); stop(); resolve("retry"); await flush(); assert.equal(timers.length, 0);
});
