import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS } from "@site-chat/shared";

import type * as LoaderNamespace from "./index";

const WIDGET_MOUNTED_KEY = "__siteChatWidgetMounted";

type LoaderModule = typeof LoaderNamespace;

function bootstrapResponse(widgetPublicKey: string) {
  return Response.json({
    data: {
      widgetPublicKey,
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
  });
}

async function mountLoader(widgetPublicKey: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(bootstrapResponse(widgetPublicKey))),
  );

  const postMessage = vi.fn();
  const iframeWindow = { postMessage } as unknown as Window;
  const appendChildSpy = vi.spyOn(document.body, "appendChild");
  appendChildSpy.mockImplementation((node) => {
    if (node instanceof HTMLIFrameElement) {
      Object.defineProperty(node, "contentWindow", {
        configurable: true,
        value: iframeWindow,
      });
    }
    return node;
  });

  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      origin: "http://localhost:3001",
      href: "http://localhost:3001/",
      protocol: "http:",
      host: "localhost:3001",
      hostname: "localhost",
      port: "3001",
    },
  });

  const script = document.createElement("script");
  script.src = "https://app.example.com/widget/loader.js";
  script.dataset.widgetKey = widgetPublicKey;
  document.body.appendChild(script);

  Object.defineProperty(document, "currentScript", {
    configurable: true,
    value: script,
  });

  const loader: LoaderModule = await import("./index");
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  return { postMessage, iframeWindow, loader };
}

function signalReady(iframeWindow: Window) {
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
}

describe("widget loader", () => {
  let activeLoader: LoaderModule | null = null;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    (window as Window & { [WIDGET_MOUNTED_KEY]?: boolean })[WIDGET_MOUNTED_KEY] = false;
    delete (window as Window & { SiteChat?: unknown }).SiteChat;
    activeLoader = null;
  });

  afterEach(() => {
    activeLoader?.teardownLoader();
    activeLoader?.restoreHistoryMethods();
    activeLoader = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("bootstraps before creating an iframe", async () => {
    const events: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        events.push("bootstrap");
        return Promise.resolve(bootstrapResponse("wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
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
      writable: true,
      value: {
        origin: "http://localhost:3001",
        href: "http://localhost:3001/",
        protocol: "http:",
        host: "localhost:3001",
        hostname: "localhost",
        port: "3001",
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

    activeLoader = await import("./index");
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(events.indexOf("bootstrap")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("iframe")).toBeGreaterThan(events.indexOf("bootstrap"));
    expect(iframeSrc).toBe(
      "https://app.example.com/widget/embed?parentOrigin=http%3A%2F%2Flocalhost%3A3001",
    );
  });

  it("includes parentOrigin on the embed iframe URL", async () => {
    const loader: LoaderModule = await import("./index");
    activeLoader = loader;
    expect(loader.buildEmbedIframeSrc("https://app.example.com", "http://localhost:3001")).toBe(
      "https://app.example.com/widget/embed?parentOrigin=http%3A%2F%2Flocalhost%3A3001",
    );
  });

  it("finds the loader script without document.currentScript (async embeds)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(bootstrapResponse("wk_cccccccccccccccccccccccccccccc"))),
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

    activeLoader = await import("./index");
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("posts init after the embed app signals readiness", async () => {
    const mounted = await mountLoader("wk_dddddddddddddddddddddddddddddddd");
    activeLoader = mounted.loader;
    const { postMessage, iframeWindow } = mounted;

    expect(postMessage).not.toHaveBeenCalled();
    signalReady(iframeWindow);

    expect(postMessage).toHaveBeenCalled();
    const initCall = postMessage.mock.calls.find(
      (call) => (call[0] as { type?: string }).type === "sitechat:init",
    );
    expect(initCall?.[0]).toMatchObject({
      source: "sitechat-loader",
      type: "sitechat:init",
      payload: {
        pageUrl: "http://localhost:3001/",
        parentOrigin: "http://localhost:3001",
      },
    });

    const pageCall = postMessage.mock.calls.find(
      (call) => (call[0] as { type?: string }).type === "sitechat:page",
    );
    expect(pageCall?.[0]).toMatchObject({
      type: "sitechat:page",
      payload: { url: "http://localhost:3001/" },
    });
  });

  it("mounts only one widget when script executes twice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(bootstrapResponse("wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"))),
    );

    const script = document.createElement("script");
    script.src = "https://app.example.com/widget/loader.js";
    script.dataset.widgetKey = "wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    document.body.appendChild(script);

    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: script,
    });

    const loader: LoaderModule = await import("./index");
    activeLoader = loader;
    loader.mount();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("throttles SPA navigation page posts and restores history methods", async () => {
    const mounted = await mountLoader("wk_ffffffffffffffffffffffffffffffff");
    activeLoader = mounted.loader;
    const { postMessage, iframeWindow, loader } = mounted;
    signalReady(iframeWindow);
    postMessage.mockClear();

    vi.useFakeTimers();

    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        origin: "http://localhost:3001",
        href: "http://localhost:3001/pricing",
        protocol: "http:",
        host: "localhost:3001",
        hostname: "localhost",
        port: "3001",
      },
    });
    history.pushState({}, "", "/pricing");

    // First navigation may be throttled relative to the ready page post.
    vi.advanceTimersByTime(VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS);

    expect(
      postMessage.mock.calls.some(
        (call) => (call[0] as { type?: string }).type === "sitechat:page",
      ),
    ).toBe(true);

    postMessage.mockClear();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        origin: "http://localhost:3001",
        href: "http://localhost:3001/docs",
        protocol: "http:",
        host: "localhost:3001",
        hostname: "localhost",
        port: "3001",
      },
    });
    history.pushState({}, "", "/docs");

    const immediatePagePosts = postMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === "sitechat:page",
    );
    expect(immediatePagePosts.length).toBe(0);

    vi.advanceTimersByTime(VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS);
    const trailing = postMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === "sitechat:page",
    );
    expect(trailing.length).toBe(1);
    expect(trailing[0]?.[0]).toMatchObject({
      payload: { url: "http://localhost:3001/docs" },
    });

    loader.restoreHistoryMethods();
  });

  it("queues SiteChat.identify until the iframe is ready", async () => {
    const mounted = await mountLoader("wk_11111111111111111111111111111111");
    activeLoader = mounted.loader;
    const { postMessage, iframeWindow } = mounted;

    const siteChat = (
      window as Window & {
        SiteChat?: { identify: (payload: { email: string }) => void; version: string };
      }
    ).SiteChat;

    expect(siteChat?.version).toBe("1");
    siteChat?.identify({ email: "ada@example.com" });
    expect(
      postMessage.mock.calls.some(
        (call) => (call[0] as { type?: string }).type === "sitechat:identify",
      ),
    ).toBe(false);

    signalReady(iframeWindow);

    const identifyCall = postMessage.mock.calls.find(
      (call) => (call[0] as { type?: string }).type === "sitechat:identify",
    );
    expect(identifyCall?.[0]).toMatchObject({
      type: "sitechat:identify",
      payload: { email: "ada@example.com" },
    });
  });

  it("ignores identify payloads that attempt to set visitor or workspace ids", async () => {
    const mounted = await mountLoader("wk_22222222222222222222222222222222");
    activeLoader = mounted.loader;
    const { postMessage, iframeWindow } = mounted;
    signalReady(iframeWindow);
    postMessage.mockClear();

    const siteChat = (
      window as Window & {
        SiteChat?: {
          identify: (payload: Record<string, unknown>) => void;
        };
      }
    ).SiteChat;

    siteChat?.identify({
      email: "ada@example.com",
      visitor_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    siteChat?.identify({
      email: "ada@example.com",
      workspaceId: "not-allowed",
    });

    expect(
      postMessage.mock.calls.some(
        (call) => (call[0] as { type?: string }).type === "sitechat:identify",
      ),
    ).toBe(false);
  });
});
