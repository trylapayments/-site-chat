import { describe, expect, it } from "vitest";

import { generateSlugFromName, isValidSlug } from "@/lib/auth/slug";

describe("generateSlugFromName", () => {
  it("lowercases and hyphenates names", () => {
    expect(generateSlugFromName("Acme Support")).toBe("acme-support");
    expect(generateSlugFromName("My Company!!!")).toBe("my-company");
  });

  it("trims leading and trailing separators", () => {
    expect(generateSlugFromName("---Hello---")).toBe("hello");
  });

  it("truncates to 63 characters", () => {
    const slug = generateSlugFromName("a".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns empty string for empty input", () => {
    expect(generateSlugFromName("   ")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("acme-support")).toBe(true);
    expect(isValidSlug("a1b")).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("Acme")).toBe(false);
    expect(isValidSlug("bad_slug")).toBe(false);
  });
});
