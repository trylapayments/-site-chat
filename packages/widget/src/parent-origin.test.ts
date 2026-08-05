import { describe, expect, it } from "vitest";

import { parseParentOriginFromQueryParam, readParentOriginFromLocation } from "./parent-origin";

describe("parentOrigin query parser", () => {
  it("accepts valid http and https origins", () => {
    expect(parseParentOriginFromQueryParam("http://localhost:3001")).toBe("http://localhost:3001");
    expect(parseParentOriginFromQueryParam("https://shop.example.com")).toBe(
      "https://shop.example.com",
    );
    expect(parseParentOriginFromQueryParam("https://shop.example.com:8443")).toBe(
      "https://shop.example.com:8443",
    );
  });

  it("accepts encoded origins from iframe URLs", () => {
    expect(parseParentOriginFromQueryParam("http%3A%2F%2Flocalhost%3A3001")).toBe(
      "http://localhost:3001",
    );
  });

  it("rejects javascript, data, null, and malformed values", () => {
    expect(parseParentOriginFromQueryParam("javascript:alert(1)")).toBeNull();
    expect(parseParentOriginFromQueryParam("data:text/html,hello")).toBeNull();
    expect(parseParentOriginFromQueryParam("null")).toBeNull();
    expect(parseParentOriginFromQueryParam("not-a-url")).toBeNull();
    expect(parseParentOriginFromQueryParam("%")).toBeNull();
  });

  it("rejects credentials, paths, query strings, and hashes", () => {
    expect(parseParentOriginFromQueryParam("https://user:pass@example.com")).toBeNull();
    expect(parseParentOriginFromQueryParam("https://example.com/path")).toBeNull();
    expect(parseParentOriginFromQueryParam("https://example.com?x=1")).toBeNull();
    expect(parseParentOriginFromQueryParam("https://example.com#section")).toBeNull();
  });

  it("reads parentOrigin from iframe location search params", () => {
    expect(
      readParentOriginFromLocation({
        search: "?parentOrigin=http%3A%2F%2Flocalhost%3A3001",
      }),
    ).toBe("http://localhost:3001");
  });
});
