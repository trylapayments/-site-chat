import { describe, expect, it } from "vitest";

import { isNearBottom, NEAR_BOTTOM_THRESHOLD_PX, shouldAutoScroll } from "./scroll";

describe("isNearBottom", () => {
  it("returns true when scrolled to the bottom", () => {
    expect(
      isNearBottom({
        scrollHeight: 1000,
        scrollTop: 800,
        clientHeight: 200,
      }),
    ).toBe(true);
  });

  it("returns true within the near-bottom threshold", () => {
    expect(
      isNearBottom({
        scrollHeight: 1000,
        scrollTop: 800 - NEAR_BOTTOM_THRESHOLD_PX,
        clientHeight: 200,
      }),
    ).toBe(true);
  });

  it("returns false when scrolled farther than the threshold", () => {
    expect(
      isNearBottom({
        scrollHeight: 1000,
        scrollTop: 800 - NEAR_BOTTOM_THRESHOLD_PX - 1,
        clientHeight: 200,
      }),
    ).toBe(false);
  });
});

describe("shouldAutoScroll", () => {
  it("always scrolls when force is set (own send / initial load)", () => {
    expect(shouldAutoScroll({ force: true, nearBottom: false })).toBe(true);
  });

  it("scrolls remote updates only when near the bottom", () => {
    expect(shouldAutoScroll({ force: false, nearBottom: true })).toBe(true);
    expect(shouldAutoScroll({ force: false, nearBottom: false })).toBe(false);
  });
});
