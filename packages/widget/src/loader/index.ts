import { VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS } from "@site-chat/shared";

const IFRAME_PATH = "/widget/embed";
const MESSAGE_SOURCE = "sitechat-loader";
const WIDGET_MOUNTED_KEY = "__siteChatWidgetMounted";
const LOCATION_CHANGE_EVENT = "sitechat:locationchange";
const SITECHAT_API_VERSION = "1";

/** Host identify payload — validated lightly here; server is authoritative. */
type IdentifyPayload = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
};

type HostIdentifyPayload = IdentifyPayload;

/**
 * Lightweight host-side gate so the loader stays small (no Zod in loader.js).
 * Full schema validation happens on the identify API route.
 */
function sanitizeHostIdentifyPayload(payload: unknown): HostIdentifyPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const source = payload as Record<string, unknown>;
  if (
    "visitor_id" in source ||
    "visitorId" in source ||
    "workspace_id" in source ||
    "workspaceId" in source
  ) {
    return null;
  }

  const result: HostIdentifyPayload = {};
  if ("name" in source) {
    if (source.name !== null && typeof source.name !== "string") return null;
    if (typeof source.name === "string" && source.name.length > 120) return null;
    result.name = source.name;
  }
  if ("email" in source) {
    if (source.email !== null && typeof source.email !== "string") return null;
    if (typeof source.email === "string" && source.email.length > 254) return null;
    result.email = source.email;
  }
  if ("phone" in source) {
    if (source.phone !== null && typeof source.phone !== "string") return null;
    if (typeof source.phone === "string" && source.phone.length > 64) return null;
    result.phone = source.phone;
  }
  if ("attributes" in source) {
    if (
      source.attributes === null ||
      typeof source.attributes !== "object" ||
      Array.isArray(source.attributes)
    ) {
      return null;
    }
    const attrs = source.attributes as Record<string, unknown>;
    const keys = Object.keys(attrs);
    if (keys.length > 50) return null;
    const cleaned: Record<string, string | number | boolean | null> = {};
    for (const key of keys) {
      if (key.length === 0 || key.length > 64) return null;
      if (
        key === "__proto__" ||
        key === "constructor" ||
        key === "prototype" ||
        key === "workspace_id" ||
        key === "visitor_id"
      ) {
        return null;
      }
      const value = attrs[key];
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return null;
      }
      if (typeof value === "string" && value.length > 500) return null;
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      cleaned[key] = value;
    }
    result.attributes = cleaned;
  }

  if (
    result.name === undefined &&
    result.email === undefined &&
    result.phone === undefined &&
    result.attributes === undefined
  ) {
    return null;
  }

  return result;
}

function isMessageFromIframe(
  event: MessageEvent,
  iframe: HTMLIFrameElement,
  expectedOrigin: string,
): boolean {
  return event.origin === expectedOrigin && event.source === iframe.contentWindow;
}

function buildEmbedIframeSrc(widgetHost: string, parentOrigin: string): string {
  const url = new URL(`${widgetHost}${IFRAME_PATH}`);
  url.searchParams.set("parentOrigin", parentOrigin);
  return url.toString();
}

type PagePayload = {
  url: string;
  title: string;
  referrer: string;
};

type LoaderInitMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "sitechat:init";
  payload: {
    widgetPublicKey: string;
    config: unknown;
    embedToken: string;
    embedTokenExpiresAt: string;
    parentOrigin: string;
    pageUrl: string;
    pageTitle: string;
    referrer: string;
  };
};

type LoaderPageMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "sitechat:page";
  payload: PagePayload;
};

type LoaderIdentifyMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "sitechat:identify";
  payload: HostIdentifyPayload;
};

type SiteChatHostApi = {
  identify(payload: IdentifyPayload): void;
  version: typeof SITECHAT_API_VERSION;
};

type LoaderWindow = Window & {
  [WIDGET_MOUNTED_KEY]?: boolean;
  __siteChatMountRetried?: boolean;
  SiteChat?: SiteChatHostApi;
};

type HistoryMethod = typeof history.pushState;

let activeIframe: HTMLIFrameElement | null = null;
let pendingInitPayload: LoaderInitMessage["payload"] | null = null;
let widgetHostOrigin: string | null = null;
let iframeReady = false;
let lastPagePostAt = 0;
let lastPostedUrl: string | null = null;
let pageViewThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let identifyQueue: HostIdentifyPayload[] = [];
let historyPatched = false;
let originalPushState: HistoryMethod | null = null;
let originalReplaceState: HistoryMethod | null = null;
let navigationCleanup: (() => void) | null = null;
let messageCleanup: (() => void) | null = null;

function getWidgetHost(script: HTMLScriptElement): string {
  return new URL(script.src).origin;
}

function getWidgetPublicKey(script: HTMLScriptElement): string | null {
  const key = script.dataset.widgetKey ?? script.dataset.sitechatKey;
  return key?.trim() || null;
}

function createIframe(widgetHost: string, parentOrigin: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = buildEmbedIframeSrc(widgetHost, parentOrigin);
  iframe.title = "Site Chat";
  iframe.setAttribute("aria-hidden", "false");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  iframe.style.position = "fixed";
  iframe.style.bottom = "0";
  iframe.style.right = "0";
  iframe.style.width = "420px";
  iframe.style.height = "640px";
  iframe.style.maxWidth = "100vw";
  iframe.style.maxHeight = "100vh";
  iframe.style.border = "0";
  iframe.style.zIndex = "2147483646";
  iframe.style.background = "transparent";
  return iframe;
}

async function bootstrap(widgetHost: string, widgetPublicKey: string) {
  const url = new URL("/api/v1/widget/bootstrap", widgetHost);
  url.searchParams.set("key", widgetPublicKey);

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error("Bootstrap failed");
  }

  const json = (await response.json()) as {
    data: {
      widgetPublicKey: string;
      config: unknown;
      embedToken: string;
      embedTokenExpiresAt: string;
    };
  };

  return json.data;
}

function currentPagePayload(): PagePayload {
  return {
    url: window.location.href,
    title: document.title || "",
    referrer: document.referrer || "",
  };
}

function postInitMessage(
  iframe: HTMLIFrameElement,
  widgetHost: string,
  payload: LoaderInitMessage["payload"],
) {
  if (!iframe.contentWindow) {
    return;
  }

  const message: LoaderInitMessage = {
    source: MESSAGE_SOURCE,
    type: "sitechat:init",
    payload,
  };

  iframe.contentWindow.postMessage(message, widgetHost);
}

function postPageMessage(force = false) {
  if (!activeIframe?.contentWindow || !widgetHostOrigin || !iframeReady) {
    return;
  }

  const page = currentPagePayload();
  const now = Date.now();
  const elapsed = Math.max(0, now - lastPagePostAt);

  if (!force && elapsed < VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS) {
    if (pageViewThrottleTimer === null) {
      pageViewThrottleTimer = setTimeout(() => {
        pageViewThrottleTimer = null;
        postPageMessage(true);
      }, VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS - elapsed);
    }
    return;
  }

  if (page.url === lastPostedUrl && (!force || lastPagePostAt > 0)) {
    return;
  }

  if (pageViewThrottleTimer !== null) {
    clearTimeout(pageViewThrottleTimer);
    pageViewThrottleTimer = null;
  }

  lastPagePostAt = now;
  lastPostedUrl = page.url;

  const message: LoaderPageMessage = {
    source: MESSAGE_SOURCE,
    type: "sitechat:page",
    payload: page,
  };

  activeIframe.contentWindow.postMessage(message, widgetHostOrigin);
}

function postIdentifyMessage(payload: HostIdentifyPayload) {
  if (!activeIframe?.contentWindow || !widgetHostOrigin || !iframeReady) {
    identifyQueue.push(payload);
    return;
  }

  const message: LoaderIdentifyMessage = {
    source: MESSAGE_SOURCE,
    type: "sitechat:identify",
    payload,
  };

  activeIframe.contentWindow.postMessage(message, widgetHostOrigin);
}

function flushIdentifyQueue() {
  if (!iframeReady) {
    return;
  }

  const queued = identifyQueue;
  identifyQueue = [];
  for (const payload of queued) {
    postIdentifyMessage(payload);
  }
}

function dispatchLocationChange() {
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

function patchHistoryMethods() {
  if (historyPatched) {
    return;
  }

  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);

  history.pushState = function patchedPushState(...args: Parameters<HistoryMethod>) {
    const pushState = originalPushState;
    if (!pushState) {
      return;
    }
    pushState(...args);
    dispatchLocationChange();
  };

  history.replaceState = function patchedReplaceState(...args: Parameters<HistoryMethod>) {
    const replaceState = originalReplaceState;
    if (!replaceState) {
      return;
    }
    replaceState(...args);
    dispatchLocationChange();
  };

  historyPatched = true;
}

function restoreHistoryMethods() {
  if (!historyPatched) {
    return;
  }

  if (originalPushState) {
    history.pushState = originalPushState;
  }
  if (originalReplaceState) {
    history.replaceState = originalReplaceState;
  }

  originalPushState = null;
  originalReplaceState = null;
  historyPatched = false;
}

function onLocationChange() {
  postPageMessage(false);
}

function installNavigationTracking() {
  patchHistoryMethods();

  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("hashchange", onLocationChange);
  window.addEventListener(LOCATION_CHANGE_EVENT, onLocationChange);

  navigationCleanup = () => {
    window.removeEventListener("popstate", onLocationChange);
    window.removeEventListener("hashchange", onLocationChange);
    window.removeEventListener(LOCATION_CHANGE_EVENT, onLocationChange);
    restoreHistoryMethods();
    navigationCleanup = null;
  };
}

function installSiteChatHostApi() {
  const loaderWindow = window as LoaderWindow;

  const api: SiteChatHostApi = {
    version: SITECHAT_API_VERSION,
    identify(payload: IdentifyPayload) {
      const sanitized = sanitizeHostIdentifyPayload(payload);
      if (!sanitized) {
        return;
      }
      postIdentifyMessage(sanitized);
    },
  };

  loaderWindow.SiteChat = api;
}

function teardownLoader() {
  messageCleanup?.();
  messageCleanup = null;
  navigationCleanup?.();
  if (pageViewThrottleTimer !== null) {
    clearTimeout(pageViewThrottleTimer);
    pageViewThrottleTimer = null;
  }
  activeIframe = null;
  pendingInitPayload = null;
  widgetHostOrigin = null;
  iframeReady = false;
  lastPagePostAt = 0;
  lastPostedUrl = null;
  identifyQueue = [];
  const loaderWindow = window as LoaderWindow;
  if (loaderWindow.SiteChat) {
    delete loaderWindow.SiteChat;
  }
  loaderWindow[WIDGET_MOUNTED_KEY] = false;
}

function mount() {
  const loaderWindow = window as LoaderWindow;
  if (loaderWindow[WIDGET_MOUNTED_KEY]) {
    return;
  }

  const script =
    document.currentScript instanceof HTMLScriptElement
      ? document.currentScript
      : document.querySelector("script[data-widget-key], script[data-sitechat-key]");

  if (!(script instanceof HTMLScriptElement)) {
    if (!loaderWindow.__siteChatMountRetried) {
      loaderWindow.__siteChatMountRetried = true;
      queueMicrotask(mount);
      return;
    }

    console.warn("[Site Chat] Loader must be executed from a script tag.");
    return;
  }

  const widgetPublicKey = getWidgetPublicKey(script);
  if (!widgetPublicKey) {
    console.warn("[Site Chat] Missing data-widget-key attribute.");
    return;
  }

  const widgetHost = getWidgetHost(script);
  widgetHostOrigin = widgetHost;

  loaderWindow[WIDGET_MOUNTED_KEY] = true;
  installSiteChatHostApi();
  installNavigationTracking();

  void bootstrap(widgetHost, widgetPublicKey)
    .then((data) => {
      const page = currentPagePayload();
      const iframe = createIframe(widgetHost, window.location.origin);
      activeIframe = iframe;
      pendingInitPayload = {
        widgetPublicKey: data.widgetPublicKey,
        config: data.config,
        embedToken: data.embedToken,
        embedTokenExpiresAt: data.embedTokenExpiresAt,
        parentOrigin: window.location.origin,
        pageUrl: page.url,
        pageTitle: page.title,
        referrer: page.referrer,
      };

      document.body.appendChild(iframe);
    })
    .catch(() => {
      teardownLoader();
      console.warn("[Site Chat] Failed to initialize widget.");
    });

  const onMessage = (event: MessageEvent) => {
    if (!activeIframe || !isMessageFromIframe(event, activeIframe, widgetHost)) {
      return;
    }

    const data = event.data as {
      source?: string;
      type?: string;
      payload?: { open?: boolean; widgetPublicKey?: string };
    };
    if (data.source !== "sitechat-embed") {
      return;
    }

    if (data.type === "sitechat:ready") {
      iframeReady = true;
      if (pendingInitPayload) {
        postInitMessage(activeIframe, widgetHost, pendingInitPayload);
        pendingInitPayload = null;
      }
      postPageMessage(true);
      flushIdentifyQueue();
      return;
    }

    if (data.type === "sitechat:visibility") {
      return;
    }

    if (data.type === "sitechat:refresh-embed" && data.payload?.widgetPublicKey) {
      void bootstrap(widgetHost, data.payload.widgetPublicKey)
        .then((boot) => {
          if (!activeIframe?.contentWindow) {
            return;
          }

          const page = currentPagePayload();
          postInitMessage(activeIframe, widgetHost, {
            widgetPublicKey: boot.widgetPublicKey,
            config: boot.config,
            embedToken: boot.embedToken,
            embedTokenExpiresAt: boot.embedTokenExpiresAt,
            parentOrigin: window.location.origin,
            pageUrl: page.url,
            pageTitle: page.title,
            referrer: page.referrer,
          });
          postPageMessage(true);
        })
        .catch(() => {
          console.warn("[Site Chat] Failed to refresh embed token.");
        });
    }
  };

  window.addEventListener("message", onMessage);
  messageCleanup = () => {
    window.removeEventListener("message", onMessage);
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

export {
  bootstrap,
  buildEmbedIframeSrc,
  mount,
  restoreHistoryMethods,
  teardownLoader,
  WIDGET_MOUNTED_KEY,
  LOCATION_CHANGE_EVENT,
  SITECHAT_API_VERSION,
};
