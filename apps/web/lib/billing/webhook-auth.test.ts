import { describe, it, expect } from "vitest";
import { validBillingWebhookAuth } from "./webhook-auth";
const basic = (value: string) =>
  `Basic ${Buffer.from(value).toString("base64")}`;
describe("billing webhook authentication", () => {
  it("rejects missing configuration and missing credentials", () => {
    expect(validBillingWebhookAuth(null, "mill", "secret")).toBe(false);
    expect(
      validBillingWebhookAuth(basic("mill:secret"), undefined, undefined),
    ).toBe(false);
  });
  it("rejects wrong credentials of equal and different lengths", () => {
    expect(
      validBillingWebhookAuth(basic("mill:secrex"), "mill", "secret"),
    ).toBe(false);
    expect(validBillingWebhookAuth(basic("mill:x"), "mill", "secret")).toBe(
      false,
    );
  });
  it("accepts the configured pair only", () => {
    expect(
      validBillingWebhookAuth(basic("mill:secret"), "mill", "secret"),
    ).toBe(true);
    expect(validBillingWebhookAuth("Bearer secret", "mill", "secret")).toBe(
      false,
    );
  });
});
