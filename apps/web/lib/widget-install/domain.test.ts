import { describe, expect, it } from "vitest";
import { buildInstallSnippet, installDomainSchema } from "./domain";
describe("widget installation", () => {
  it("normalizes exact website hostnames, including IDNs", () => {
    expect(installDomainSchema.parse(" HTTPS://WWW.Example.com/ ")).toBe(
      "www.example.com",
    );
    expect(installDomainSchema.parse("example.com.")).toBe("example.com");
    expect(installDomainSchema.parse("bücher.de")).toBe("xn--bcher-kva.de");
  });
  it.each([
    "*.example.com",
    "example.com/path",
    "example.com?x=1",
    "example.com#x",
    "example.com:443",
    "https://a:b@example.com",
    "127.0.0.1",
    "localhost",
    "javascript:alert(1)",
    "evil..com",
    "-bad.com",
    "https://example.com:8080",
    "foo.example.com/../",
    "https://example.com//",
  ])("rejects unsafe or ambiguous domain %s", (input) => {
    expect(installDomainSchema.safeParse(input).success).toBe(false);
  });
  it("generates the real loader snippet without client secrets", () => {
    expect(buildInstallSnippet("https://mill.chat/app", "wk_public")).toBe(
      '<script\n  src="https://mill.chat/widget/loader.js"\n  data-widget-key="wk_public"\n  async\n></script>',
    );
  });
});
