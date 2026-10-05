import { describe, it, expect } from "vitest";
import { platformChangeSchema } from "./schema";
const base = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  version: 0,
  reason: "Customer requested change",
};
describe("platform request boundaries", () => {
  it("rejects unknown features and arbitrary company properties", () => {
    expect(
      platformChangeSchema.safeParse({
        ...base,
        change: {
          action: "company",
          payload: { name: "Test", secret: "value" },
        },
      }).success,
    ).toBe(false);
    expect(
      platformChangeSchema.safeParse({
        ...base,
        change: {
          action: "access",
          payload: {
            access_mode: "pilot",
            features: { unsafe: true },
            limits: {
              operator_seats: null,
              monthly_conversations: null,
              monthly_ai_requests: null,
              storage_mb: null,
            },
            override_expires_at: null,
          },
        },
      }).success,
    ).toBe(false);
  });
  it("rejects expired trials and ambiguous domain wildcards", () => {
    expect(
      platformChangeSchema.safeParse({
        ...base,
        change: {
          action: "trial",
          payload: { trial_ends_at: "2020-01-01T00:00:00Z" },
        },
      }).success,
    ).toBe(false);
    expect(
      platformChangeSchema.safeParse({
        ...base,
        change: {
          action: "domain",
          payload: { domain: "*.example.com", operation: "allow" },
        },
      }).success,
    ).toBe(false);
  });
  it("requires the audit reason and optimistic version", () => {
    expect(
      platformChangeSchema.safeParse({
        ...base,
        reason: "",
        change: { action: "note", payload: { body: "Test" } },
      }).success,
    ).toBe(false);
    expect(
      platformChangeSchema.safeParse({
        ...base,
        version: -1,
        change: { action: "note", payload: { body: "Test" } },
      }).success,
    ).toBe(false);
  });
});
