import { describe, expect, it } from "vitest";
import { resolveBillingAccess, type AccessInput } from "./access-policy";
const now = Date.parse("2026-10-05T12:00:00Z");
const base: AccessInput = {
  suspended: false,
  legacyPilot: false,
  controls: null,
  subscription: null,
};
const controls = {
  access_mode: "standard",
  plan_id: "business",
  trial_ends_at: null,
  override_expires_at: null,
};
describe("Mill access precedence", () => {
  it("keeps a complimentary plan despite failed or cancelled billing", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          controls,
          subscription: {
            status: "cancelled",
            priceId: "mill-starter-usd-monthly",
          },
        },
        now,
      ),
    ).toMatchObject({
      enabled: true,
      planId: "business",
      source: "complimentary",
    });
  });
  it("suspension wins over a paid subscription and a manual grant", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          suspended: true,
          controls,
          subscription: {
            status: "active",
            priceId: "mill-business-usd-monthly",
            termEnd: now / 1000 + 1000,
          },
        },
        now,
      ).enabled,
    ).toBe(false);
  });
  it("returns to paid access when a complimentary grant expires", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          controls: {
            ...controls,
            override_expires_at: new Date(now - 1).toISOString(),
          },
          subscription: {
            status: "active",
            priceId: "mill-essential-usd-monthly",
            termEnd: now / 1000 + 1000,
          },
        },
        now,
      ),
    ).toMatchObject({ planId: "essential", source: "subscription" });
  });
  it("honours a Mill trial despite provider cancellation", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          controls: {
            ...controls,
            plan_id: null,
            access_mode: "trial",
            trial_ends_at: new Date(now + 1000).toISOString(),
          },
        },
        now,
      ),
    ).toMatchObject({ enabled: true, source: "trial" });
  });
  it("expires trials and scheduled cancellations without requiring another webhook", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          subscription: {
            status: "non_renewing",
            priceId: "mill-growth-usd-monthly",
            termEnd: now / 1000,
          },
        },
        now,
      ).enabled,
    ).toBe(false);
  });
  it("does not grant access for an unknown provider price", () => {
    expect(
      resolveBillingAccess(
        {
          ...base,
          subscription: {
            status: "active",
            priceId: "demo",
            termEnd: now / 1000 + 1000,
          },
        },
        now,
      ).enabled,
    ).toBe(false);
  });
});
