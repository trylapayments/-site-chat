import test from "node:test";
import assert from "node:assert/strict";
import { copyPreparedFile } from "./prepare-file.ts";
test("waits for copying before reading upload size", async () => {
  let copied = false;
  const bytes = await copyPreparedFile(
    async () => {
      await Promise.resolve();
      copied = true;
    },
    () => (copied ? 1234 : 0),
  );
  assert.equal(bytes, 1234);
});
test("rejects empty files and propagates copy failures", async () => {
  await assert.rejects(
    copyPreparedFile(
      async () => {},
      () => 0,
    ),
    /prepare/,
  );
  await assert.rejects(
    copyPreparedFile(
      async () => {
        throw new Error("copy failed");
      },
      () => 123,
    ),
    /copy failed/,
  );
});
