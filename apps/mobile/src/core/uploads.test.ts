import test from "node:test";
import assert from "node:assert/strict";
import { reusableUpload, duplicateUpload } from "./uploads.ts";

test("expired signed upload is renewed without replacing the message UUID", () => {
  const upload = {
    batchId: "batch",
    uploads: [
      { uploadId: "file", uploadUrl: "https://storage.test", expiresAt: "2026-10-06T00:00:00Z" },
    ],
  };
  assert.equal(reusableUpload(upload, Date.parse("2026-10-06T00:00:00Z")), undefined);
  assert.equal(reusableUpload(upload, Date.parse("2026-10-05T00:00:00Z")), upload);
});
test("only duplicate-object errors allow finalization after interrupted upload", () => {
  assert.equal(duplicateUpload(409, null), true);
  assert.equal(duplicateUpload(400, { error: "Duplicate", statusCode: "409" }), true);
  assert.equal(duplicateUpload(400, { error: "InvalidJWT" }), false);
  assert.equal(duplicateUpload(403, { error: "Duplicate" }), false);
});
