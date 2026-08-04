import { describe, expect, it } from "vitest";

import { isMessageFromIframe, isMessageFromParent } from "./post-message";

describe("postMessage validation", () => {
  it("accepts iframe messages only from the widget host origin and iframe window", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);

    const trusted = new MessageEvent("message", {
      origin: "https://app.example.com",
      source: iframe.contentWindow,
    });

    const wrongOrigin = new MessageEvent("message", {
      origin: "https://evil.example.com",
      source: iframe.contentWindow,
    });

    expect(isMessageFromIframe(trusted, iframe, "https://app.example.com")).toBe(true);
    expect(isMessageFromIframe(wrongOrigin, iframe, "https://app.example.com")).toBe(false);

    iframe.remove();
  });

  it("accepts parent init messages only from the parent window and origin", () => {
    const trusted = new MessageEvent("message", {
      origin: "https://customer.example.com",
      source: window.parent,
    });

    const wrongSource = new MessageEvent("message", {
      origin: "https://customer.example.com",
      source: null,
    });

    expect(isMessageFromParent(trusted, "https://customer.example.com")).toBe(true);
    expect(isMessageFromParent(wrongSource, "https://customer.example.com")).toBe(false);
  });
});
