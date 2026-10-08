import { describe, expect, it } from "vitest";

import {
  isEmbedMessageType,
  isLoaderMessageType,
  isMessageFromIframe,
  isMessageFromParent,
} from "./post-message";

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

    const wrongOrigin = new MessageEvent("message", {
      origin: "https://evil.example.com",
      source: window.parent,
    });

    expect(isMessageFromParent(trusted, "https://customer.example.com")).toBe(true);
    expect(isMessageFromParent(wrongSource, "https://customer.example.com")).toBe(false);
    expect(isMessageFromParent(wrongOrigin, "https://customer.example.com")).toBe(false);
  });

  it("validates ready and init postMessage origin and source together", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeWindow = iframe.contentWindow;

    const readyFromEmbed = new MessageEvent("message", {
      origin: "https://app.example.com",
      source: iframeWindow,
      data: { source: "sitechat-embed", type: "sitechat:ready" },
    });

    const initFromParent = new MessageEvent("message", {
      origin: "http://localhost:3001",
      source: window.parent,
      data: {
        source: "sitechat-loader",
        type: "sitechat:init",
        payload: { parentOrigin: "http://localhost:3001" },
      },
    });

    expect(isMessageFromIframe(readyFromEmbed, iframe, "https://app.example.com")).toBe(true);
    expect(isMessageFromIframe(readyFromEmbed, iframe, "https://evil.example.com")).toBe(false);
    expect(isMessageFromParent(initFromParent, "http://localhost:3001")).toBe(true);
    expect(isMessageFromParent(initFromParent, "https://evil.example.com")).toBe(false);

    iframe.remove();
  });

  it("recognizes loader and embed message types", () => {
    expect(isLoaderMessageType("sitechat:init")).toBe(true);
    expect(isLoaderMessageType("sitechat:page")).toBe(true);
    expect(isLoaderMessageType("sitechat:identify")).toBe(true);
    expect(isLoaderMessageType("sitechat:ready")).toBe(false);
    expect(isEmbedMessageType("sitechat:ready")).toBe(true);
    expect(isEmbedMessageType("sitechat:page")).toBe(false);
  });
});
