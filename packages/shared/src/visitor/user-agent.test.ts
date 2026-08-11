import { describe, expect, it } from "vitest";

import { parseUserAgent } from "./user-agent";

describe("parseUserAgent", () => {
  it("detects chrome on windows desktop", () => {
    const result = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    expect(result).toMatchObject({
      browserFamily: "Chrome",
      browserVersion: "120.0",
      osFamily: "Windows",
      deviceType: "desktop",
    });
  });

  it("detects safari on iOS mobile", () => {
    const result = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(result.browserFamily).toBe("Safari");
    expect(result.osFamily).toBe("iOS");
    expect(result.deviceType).toBe("mobile");
  });

  it("detects bots", () => {
    expect(parseUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)").deviceType).toBe(
      "bot",
    );
  });

  it("handles empty ua", () => {
    expect(parseUserAgent(null)).toEqual({
      browserFamily: null,
      browserVersion: null,
      osFamily: null,
      deviceType: "unknown",
    });
  });
});
