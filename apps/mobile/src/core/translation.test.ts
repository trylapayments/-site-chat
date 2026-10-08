import assert from "node:assert/strict";
import test from "node:test";
import { acceptTranslationPreview } from "./translation.ts";

const preview = { source: "Hello", translatedText: "Bonjour", targetLanguage: "fr" as const };
test("accepts only the reviewed unchanged draft", () => {
  assert.equal(
    acceptTranslationPreview(preview, "Hello", "user:company:chat", "user:company:chat", "fr"),
    "Bonjour",
  );
});
test("editing the draft invalidates an earlier translation", () => {
  assert.equal(acceptTranslationPreview(preview, "Hello again", "scope", "scope", "fr"), null);
});
test("changing account, company or chat rejects late results", () => {
  for (const next of ["other:company:chat", "user:other:chat", "user:company:other"])
    assert.equal(acceptTranslationPreview(preview, "Hello", "user:company:chat", next, "fr"), null);
});
test("changing target language invalidates the preview", () => {
  assert.equal(acceptTranslationPreview(preview, "Hello", "scope", "scope", "de"), null);
});
test("empty results and missing scope cannot replace a draft", () => {
  assert.equal(
    acceptTranslationPreview({ ...preview, translatedText: " " }, "Hello", "scope", "scope", "fr"),
    null,
  );
  assert.equal(acceptTranslationPreview(preview, "Hello", "", "", "fr"), null);
});
