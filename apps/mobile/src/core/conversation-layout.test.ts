import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationLayout } from "./conversation-layout.ts";

test("folding or narrowing the window leaves enough room for the composer", () => {
  for (const width of [320, 393, 600, 744, 768]) {
    assert.deepEqual(conversationLayout(width, 1), { split: false, sidebarWidth: 0 });
  }
  for (const width of [840, 890, 1024, 1366]) {
    const layout = conversationLayout(width, 1);
    assert.equal(layout.split, true);
    assert.ok(width - layout.sidebarWidth >= 460);
    assert.ok(layout.sidebarWidth >= 320 && layout.sidebarWidth <= 400);
  }
});

test("large accessibility text requires wider panes rather than squeezing controls", () => {
  assert.equal(conversationLayout(840, 1.5).split, false);
  assert.equal(conversationLayout(1366, 1.5).split, true);
  assert.equal(conversationLayout(Number.NaN, 1).split, false);
});
