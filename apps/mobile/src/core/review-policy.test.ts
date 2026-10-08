import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewEligible, recordReviewClose } from "./review-policy.ts";
const day = 86_400_000;
test("review requires one week, five distinct closed conversations and recent work", () => {
  let state = { firstUse: 0, closed: [] as string[] };
  for (let i = 0; i < 5; i++) state = recordReviewClose(state, `company:${i}`, 7 * day);
  assert.equal(reviewEligible(state, 7 * day - 1), false);
  assert.equal(reviewEligible(state, 7 * day), true);
  assert.equal(reviewEligible({ ...state, closed: state.closed.slice(1) }, 7 * day), false);
  assert.equal(reviewEligible(state, 9 * day), false);
  assert.equal(recordReviewClose(state, "company:0", 8 * day), state);
});
test("review retry observes a 120 day cooldown", () => {
  const state = {
    firstUse: 0,
    closed: ["a", "b", "c", "d", "e"],
    lastClosed: 130 * day,
    lastAttempt: 10 * day,
  };
  assert.equal(reviewEligible(state, 130 * day), true);
  assert.equal(reviewEligible({ ...state, lastAttempt: 11 * day }, 130 * day), false);
});
