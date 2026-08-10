import { describe, expect, it } from "vitest";

import { shouldInvalidateSuggestionForVisitorMessage } from "./stale-suggestion";

describe("shouldInvalidateSuggestionForVisitorMessage", () => {
  it("invalidates when a new visitor message arrives after a prior one", () => {
    expect(shouldInvalidateSuggestionForVisitorMessage("msg-1", "msg-2")).toBe(
      true,
    );
  });

  it("does not invalidate on the first visitor message observation", () => {
    expect(shouldInvalidateSuggestionForVisitorMessage(null, "msg-1")).toBe(
      false,
    );
  });

  it("does not invalidate when the visitor message id is unchanged", () => {
    expect(shouldInvalidateSuggestionForVisitorMessage("msg-1", "msg-1")).toBe(
      false,
    );
  });
});
