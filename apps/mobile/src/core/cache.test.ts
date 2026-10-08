import test from "node:test";
import assert from "node:assert/strict";
import { cacheKey, cached, remember, clearCache } from "../lib/cache.ts";
test("conversation cache isolates accounts and workspaces and clears at logout", () => {
  clearCache();
  const key = cacheKey("alice", "workspace-a", "chat:one");
  remember(key, { text: "private" });
  assert.deepEqual(cached(key), { text: "private" });
  assert.equal(cached(cacheKey("bob", "workspace-a", "chat:one")), undefined);
  assert.equal(cached(cacheKey("alice", "workspace-b", "chat:one")), undefined);
  clearCache();
  assert.equal(cached(key), undefined);
});
test("expired content is discarded and the cache remains bounded", () => {
  clearCache();
  remember("expired", "value", -1);
  assert.equal(cached("expired"), undefined);
  for (let i = 0; i < 101; i++) remember(String(i), i);
  assert.equal(cached("0"), undefined);
  assert.equal(cached("100"), 100);
});
