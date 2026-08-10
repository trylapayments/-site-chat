import { describe, expect, it } from "vitest";

import {
  mergeVisitorAttributes,
  normalizeVisitorAttributes,
  normalizeVisitorEmail,
  normalizeVisitorName,
  normalizeVisitorPhone,
  VisitorIdentityError,
} from "./identity";

describe("normalizeVisitorName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeVisitorName("  Jane   Doe  ")).toBe("Jane Doe");
  });

  it("rejects oversized names", () => {
    expect(() => normalizeVisitorName("a".repeat(121))).toThrow(VisitorIdentityError);
  });

  it("strips control characters", () => {
    expect(normalizeVisitorName("Jane\u0000 Doe")).toBe("Jane Doe");
  });
});

describe("normalizeVisitorEmail", () => {
  it("lowercases domain only", () => {
    expect(normalizeVisitorEmail("Jane.Doe@Example.COM")).toBe("Jane.Doe@example.com");
  });

  it("rejects invalid formats", () => {
    expect(() => normalizeVisitorEmail("not-an-email")).toThrow(VisitorIdentityError);
    expect(() => normalizeVisitorEmail("a@b")).toThrow(VisitorIdentityError);
  });

  it("returns null for empty", () => {
    expect(normalizeVisitorEmail("  ")).toBeNull();
  });
});

describe("normalizeVisitorPhone", () => {
  it("keeps display and normalized digits with plus", () => {
    expect(normalizeVisitorPhone("+1 (555) 123-4567")).toEqual({
      normalized: "+15551234567",
      display: "+1 (555) 123-4567",
    });
  });

  it("does not invent a country code", () => {
    expect(normalizeVisitorPhone("555-123-4567")).toEqual({
      normalized: "5551234567",
      display: "555-123-4567",
    });
  });
});

describe("normalizeVisitorAttributes", () => {
  it("accepts primitive values", () => {
    expect(
      normalizeVisitorAttributes({
        plan: "enterprise",
        seats: 10,
        active: true,
        note: null,
      }),
    ).toMatchObject({
      plan: "enterprise",
      seats: 10,
      active: true,
      note: null,
    });
  });

  it("rejects reserved and prototype keys", () => {
    // JSON.parse creates an own "__proto__" key; object literals do not.
    expect(() => normalizeVisitorAttributes(JSON.parse('{"__proto__":"x"}') as object)).toThrow(
      VisitorIdentityError,
    );
    expect(() => normalizeVisitorAttributes({ workspace_id: "x" })).toThrow(VisitorIdentityError);
    expect(() => normalizeVisitorAttributes({ constructor: "x" })).toThrow(VisitorIdentityError);
  });

  it("rejects nested objects and arrays", () => {
    expect(() => normalizeVisitorAttributes({ meta: { a: 1 } })).toThrow(VisitorIdentityError);
    expect(() => normalizeVisitorAttributes({ tags: ["a"] })).toThrow(VisitorIdentityError);
  });

  it("merges and deletes with null", () => {
    const merged = mergeVisitorAttributes(
      { plan: "starter", tier: "gold" },
      { plan: "enterprise", tier: null, seats: 5 },
    );
    expect(merged).toEqual({ plan: "enterprise", seats: 5 });
  });
});
