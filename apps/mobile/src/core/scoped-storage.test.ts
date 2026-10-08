import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeStorage } from "./scoped-storage.ts";

test("switching backend cannot restore staging credentials or deliver its queued messages", async () => {
  const values = new Map<string, string>([["mill.session", "legacy-staging-token"]]);
  const durable = {
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    },
  };
  const staging = scopeStorage(durable, "https://staging.supabase.co", "https://staging.mill.chat");
  const live = scopeStorage(durable, "https://live.supabase.co", "https://app.mill.chat");
  await staging.setItem("mill.session", "staging-token");
  await staging.setItem("mill.outbox.same-user", "staging-pending-message");
  assert.equal(await live.getItem("mill.session"), null);
  assert.equal(await live.getItem("mill.outbox.same-user"), null);
  await live.setItem("mill.session", "live-token");
  await live.removeItem("mill.outbox.same-user");
  assert.equal(await staging.getItem("mill.outbox.same-user"), "staging-pending-message");
  assert.equal(await staging.getItem("mill.session"), "staging-token");
  assert.equal(
    await scopeStorage(durable, "https://live.supabase.co/", "https://app.mill.chat/").getItem(
      "mill.session",
    ),
    "live-token",
  );
  assert.ok([...values.keys()].every((key) => /^[a-zA-Z0-9._-]+$/.test(key)));
});
