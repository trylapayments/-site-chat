import { expect, it } from "vitest";
import {
  resolveTranslationAllowance,
  translationLimitFromPriceId,
} from "./entitlement";
it("never confuses legacy Business with the versioned Business plan", () => {
  expect(translationLimitFromPriceId("mill-business-usd-monthly")).toBe(0);
  expect(translationLimitFromPriceId("mill-v2-business-usd-monthly")).toBe(
    5000,
  );
  expect(translationLimitFromPriceId("mill-v2-enterprise-usd-annual")).toBe(
    15000,
  );
  expect(translationLimitFromPriceId("mill-v2-starter-usd-monthly")).toBe(0);
});
it("preserves subscribed access until cancellation term ends", () => {
  const subscription = {
    status: "non_renewing",
    termEnd: 200,
    priceId: "mill-v2-professional-usd-monthly",
  };
  expect(
    resolveTranslationAllowance({
      workspaceEnabled: true,
      subscription,
      explicitlyApprovedPilot: false,
      nowMs: 199000,
    }),
  ).toBe(1000);
  expect(
    resolveTranslationAllowance({
      workspaceEnabled: true,
      subscription,
      explicitlyApprovedPilot: false,
      nowMs: 200000,
    }),
  ).toBe(0);
});
it("rejects disabled companies even in an approved pilot", () => {
  expect(
    resolveTranslationAllowance({
      workspaceEnabled: false,
      subscription: null,
      explicitlyApprovedPilot: true,
    }),
  ).toBe(0);
});
it("never grants translation automatically for an unsubscribed or legacy company", () => {
  expect(
    resolveTranslationAllowance({
      workspaceEnabled: true,
      subscription: null,
      explicitlyApprovedPilot: false,
    }),
  ).toBe(0);
  expect(
    resolveTranslationAllowance({
      workspaceEnabled: true,
      subscription: {
        status: "active",
        termEnd: 200,
        priceId: "mill-business-usd-annual",
      },
      explicitlyApprovedPilot: false,
      nowMs: 0,
    }),
  ).toBe(0);
});
