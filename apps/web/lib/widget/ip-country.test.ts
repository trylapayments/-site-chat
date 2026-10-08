import { afterEach, describe, expect, it, vi } from "vitest";
import { ipCountryFromRequest, ipCityFromRequest } from "./ip-country";
afterEach(() => vi.unstubAllEnvs());
describe("IP country provenance", () => {
  it("ignores a spoofed country header outside the trusted edge", () => {
    vi.stubEnv("VERCEL", "");
    expect(
      ipCountryFromRequest(
        new Request("https://mill.chat", {
          headers: { "x-vercel-ip-country": "US" },
        }),
      ),
    ).toBeNull();
  });
  it("uses the edge IP country, independently of browser language", () => {
    vi.stubEnv("VERCEL", "1");
    expect(
      ipCountryFromRequest(
        new Request("https://mill.chat", {
          headers: { "x-vercel-ip-country": "gb", "accept-language": "ru" },
        }),
      ),
    ).toBe("GB");
  });
  it.each(["", "XX", "USA", "??"])(
    "does not show an unknown or malformed country %s",
    (code) => {
      vi.stubEnv("VERCEL", "1");
      expect(
        ipCountryFromRequest(
          new Request("https://mill.chat", {
            headers: { "x-vercel-ip-country": code },
          }),
        ),
      ).toBeNull();
    },
  );
});

describe("IP city provenance", () => {
  it("does not trust city headers off the edge", () => {
    vi.stubEnv("VERCEL", "");
    expect(
      ipCityFromRequest(
        new Request("https://mill.chat", {
          headers: { "x-vercel-ip-city": "London" },
        }),
      ),
    ).toBeNull();
  });
  it("decodes unicode edge city names", () => {
    vi.stubEnv("VERCEL", "1");
    expect(
      ipCityFromRequest(
        new Request("https://mill.chat", {
          headers: { "x-vercel-ip-city": "S%C3%A3o%20Paulo" },
        }),
      ),
    ).toBe("São Paulo");
  });
  it.each(["%", "%00London", "a".repeat(129)])(
    "rejects invalid city %s",
    (city) => {
      vi.stubEnv("VERCEL", "1");
      expect(
        ipCityFromRequest(
          new Request("https://mill.chat", {
            headers: { "x-vercel-ip-city": city },
          }),
        ),
      ).toBeNull();
    },
  );
});
