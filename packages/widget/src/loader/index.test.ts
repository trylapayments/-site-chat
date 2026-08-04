import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WIDGET_MOUNTED_KEY } from "./index";

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
    appendChildSpy.mockImplementation((node) => {
      if (node instanceof HTMLIFrameElement) {
        events.push("iframe");
      }
      return node;
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
