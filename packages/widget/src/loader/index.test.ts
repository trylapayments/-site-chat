import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildEmbedIframeSrc, WIDGET_MOUNTED_KEY } from "./index";

describe("widget loader", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    (window as Window & { [WIDGET_MOUNTED_KEY]?: boolean })[WIDGET_MOUNTED_KEY] = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bootstraps before creating an iframe", async () => {
    const events: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        events.push("bootstrap");
        return Promise.resolve(
          Response.json({
            data: {
              widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              config: {
                locale: "en",
                greetingMessage: "Hi",
                reopenWindowHours: 24,
                branding: {
                  displayName: null,
                  logoUrl: null,
                  primaryColor: "#0066FF",
                  showPoweredBy: true,
                },
                position: "bottom-right",
              },
              embedToken: "embed-token",
              embedTokenExpiresAt: new Date().toISOString(),
            },
          }),
        );
      }),
    );

    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    let iframeSrc = "";
    appendChildSpy.mockImplementation((node) => {
      if (node instanceof HTMLIFrameElement) {
        events.push("iframe");
        iframeSrc = node.src;
      }
      return node;
    });

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "http://localhost:3001",
      },
    });

    const script = document.createElement("script");
    script.src = "https://app.example.com/widget/loader.js";
    script.dataset.widgetKey = "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    document.body.appendChild(script);

    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: script,
    });

    await import("./index");
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(events.indexOf("bootstrap")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("iframe")).toBeGreaterThan(events.indexOf("bootstrap"));
    expect(iframeSrc).toBe(
      "https://app.example.com/widget/embed?parentOrigin=http%3A%2F%2Flocalhost%3A3001",
    );
  });

  it("includes parentOrigin on the embed iframe URL", () => {
    expect(buildEmbedIframeSrc("https://app.example.com", "http://localhost:3001")).toBe(
      "https://app.example.com/widget/embed?parentOrigin=http%3A%2F%2Flocalhost%3A3001",
    );
  });

  it("finds the loader script without document.currentScript (async embeds)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            data: {
              widgetPublicKey: "wk_cccccccccccccccccccccccccccccc",
              config: {
                locale: "en",
                greetingMessage: "Hi",
                reopenWindowHours: 24,
                branding: {
                  displayName: null,
                  logoUrl: null,
                  primaryColor: "#0066FF",
                  showPoweredBy: true,
                },
                position: "bottom-right",
              },
              embedToken: "embed-token",
              embedTokenExpiresAt: new Date().toISOString(),
            },
          }),
        ),
      ),
    );

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://app.example.com/widget/loader.js";
    script.dataset.widgetKey = "wk_cccccccccccccccccccccccccccccc";
    document.body.appendChild(script);

    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: null,
    });

    await import("./index");
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("posts init after the embed app signals readiness", async () => {
    const events: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        events.push("bootstrap");
        return Promise.resolve(
          Response.json({
            data: {
              widgetPublicKey: "wk_dddddddddddddddddddddddddddddddd",
              config: {
                locale: "en",
                greetingMessage: "Hi",
                reopenWindowHours: 24,
                branding: {
                  displayName: null,
                  logoUrl: null,
                  primaryColor: "#0066FF",
                  showPoweredBy: true,
                },
                position: "bottom-right",
              },
              embedToken: "embed-token",
              embedTokenExpiresAt: new Date().toISOString(),
            },
          }),
        );
      }),
    );

    const postMessage = vi.fn();
    const iframeWindow = { postMessage } as unknown as Window;
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    appendChildSpy.mockImplementation((node) => {
      if (node instanceof HTMLIFrameElement) {
        events.push("iframe");
        Object.defineProperty(node, "contentWindow", {
          configurable: true,
          value: iframeWindow,
        });
      }
      return node;
    });

    const script = document.createElement("script");
    script.src = "https://app.example.com/widget/loader.js";
    script.dataset.widgetKey = "wk_dddddddddddddddddddddddddddddddd";
    document.body.appendChild(script);

    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: script,
    });

    await import("./index");
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://app.example.com",
        source: iframeWindow,
        data: {
          source: "sitechat-embed",
          type: "sitechat:ready",
        },
      }),
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(events.indexOf("bootstrap")).toBeLessThan(events.indexOf("iframe"));
  });

  it("mounts only one widget when script executes twice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            data: {
              widgetPublicKey: "wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              config: {
                locale: "en",
                greetingMessage: "Hi",
                reopenWindowHours: 24,
                branding: {
                  displayName: null,
                  logoUrl: null,
                  primaryColor: "#0066FF",
                  showPoweredBy: true,
                },
                position: "bottom-right",
              },
              embedToken: "embed-token",
              embedTokenExpiresAt: new Date().toISOString(),
            },
          }),
        ),
      ),
    );

    const script = document.createElement("script");
    script.src = "https://app.example.com/widget/loader.js";
    script.dataset.widgetKey = "wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    document.body.appendChild(script);

    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: script,
    });

    const loader = await import("./index");
    loader.mount();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });
});
