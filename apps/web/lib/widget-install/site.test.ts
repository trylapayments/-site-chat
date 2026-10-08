import { describe, it, expect } from "vitest";
import { canonicalSite } from "./site";
describe("website identity", () => {
  it("shares www branding while keeping separate subdomains", () => {
    expect(canonicalSite("https://www.Example.com")).toBe("example.com");
    expect(canonicalSite("support.example.com")).toBe("support.example.com");
  });
  it("rejects wildcards and invalid hosts", () => {
    expect(() => canonicalSite("*.example.com")).toThrow();
    expect(() => canonicalSite("localhost")).toThrow();
  });
});
