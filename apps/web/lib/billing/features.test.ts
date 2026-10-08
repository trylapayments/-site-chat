import { describe, expect, it } from "vitest";
import { millPlanFeatures } from "./features";
describe("pricing capabilities", () => {
  it("keeps chat available on Starter without AI or white label", () => {
    expect(millPlanFeatures("starter")).toMatchObject({
      chat: true,
      ai: false,
      removeBranding: false,
      monthlyAIConversations: 0,
    });
  });
  it("matches advertised allowances", () => {
    expect(
      ["essential", "growth", "business"].map(
        (p) =>
          millPlanFeatures(p as "essential" | "growth" | "business")
            .monthlyAIConversations,
      ),
    ).toEqual([100, 500, 1000]);
  });
  it("does not grant restricted features with missing plan or suspended access", () => {
    expect(millPlanFeatures(null).ai).toBe(false);
    expect(millPlanFeatures("business", false)).toMatchObject({
      chat: false,
      ai: false,
      removeBranding: false,
    });
  });
});
