import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheSessionStorage } from "./cached-storage.ts";

test("session reads avoid repeated durable reads and writes update the cache", async () => {
  let value: string | null = "first";
  let reads = 0;
  const cached = cacheSessionStorage(
    {
      async getItem() {
        reads++;
        return value;
      },
      async setItem(_key, next) {
        value = next;
      },
      async removeItem() {
        value = null;
      },
    },
    "session",
  );
  assert.equal(await cached.getItem("session"), "first");
  assert.equal(await cached.getItem("session"), "first");
  assert.equal(reads, 1);
  await cached.setItem("session", "refreshed");
  assert.equal(await cached.getItem("session"), "refreshed");
  await cached.removeItem("session");
  assert.equal(await cached.getItem("session"), null);
  assert.equal(reads, 1);
});

test("failed persistence never publishes an unpersisted session", async () => {
  const cached = cacheSessionStorage(
    {
      async getItem() {
        return "saved";
      },
      async setItem() {
        throw new Error("Disk failure");
      },
      async removeItem() {},
    },
    "session",
  );
  await cached.getItem("session");
  await assert.rejects(cached.setItem("session", "unsaved"));
  assert.equal(await cached.getItem("session"), "saved");
});

test("an in-flight old read cannot restore a session after logout", async () => {
  let finish!: (value: string | null) => void;
  const cached = cacheSessionStorage(
    {
      getItem() {
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      async setItem() {},
      async removeItem() {},
    },
    "session",
  );
  const oldRead = cached.getItem("session");
  await Promise.resolve();
  await Promise.resolve();
  await cached.removeItem("session");
  finish("old-session");
  assert.equal(await oldRead, null);
});
