const IFRAME_PATH = "/widget/embed";
const MESSAGE_SOURCE = "sitechat-loader";
const WIDGET_MOUNTED_KEY = "__siteChatWidgetMounted";

function isMessageFromIframe(
  event: MessageEvent,
  iframe: HTMLIFrameElement,
  expectedOrigin: string,
): boolean {
  return event.origin === expectedOrigin && event.source === iframe.contentWindow;
}

type LoaderInitMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "sitechat:init";
  payload: {
    widgetPublicKey: string;
    config: unknown;
    embedToken: string;
    embedTokenExpiresAt: string;
    parentOrigin: string;
  };
};

type LoaderWindow = Window & {
  [WIDGET_MOUNTED_KEY]?: boolean;
};

let activeIframe: HTMLIFrameElement | null = null;

function getWidgetHost(script: HTMLScriptElement): string {
  return new URL(script.src).origin;
}

function getWidgetPublicKey(script: HTMLScriptElement): string | null {
  const key = script.dataset.widgetKey ?? script.dataset.sitechatKey;
  return key?.trim() || null;
}

function createIframe(widgetHost: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = `${widgetHost}${IFRAME_PATH}`;
  iframe.title = "Site Chat";
  iframe.setAttribute("aria-hidden", "true");
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
  iframe.style.display = "none";
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

function mount() {
  const loaderWindow = window as LoaderWindow;
  if (loaderWindow[WIDGET_MOUNTED_KEY]) {
    return;
  }

  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) {
    console.warn("[Site Chat] Loader must be executed from a script tag.");
    return;
  }

  const widgetPublicKey = getWidgetPublicKey(script);
  if (!widgetPublicKey) {
    console.warn("[Site Chat] Missing data-widget-key attribute.");
    return;
  }

  const widgetHost = getWidgetHost(script);

  loaderWindow[WIDGET_MOUNTED_KEY] = true;

  void bootstrap(widgetHost, widgetPublicKey)
    .then((data) => {
      const iframe = createIframe(widgetHost);
      activeIframe = iframe;

      iframe.addEventListener("load", () => {
        postInitMessage(iframe, widgetHost, {
          widgetPublicKey: data.widgetPublicKey,
          config: data.config,
          embedToken: data.embedToken,
          embedTokenExpiresAt: data.embedTokenExpiresAt,
          parentOrigin: window.location.origin,
        });
      });

      document.body.appendChild(iframe);
    })
    .catch(() => {
      loaderWindow[WIDGET_MOUNTED_KEY] = false;
      console.warn("[Site Chat] Failed to initialize widget.");
    });

  window.addEventListener("message", (event) => {
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

    if (data.type === "sitechat:visibility") {
      activeIframe.style.display = data.payload?.open ? "block" : "none";
      activeIframe.setAttribute("aria-hidden", data.payload?.open ? "false" : "true");
      return;
    }

    if (data.type === "sitechat:refresh-embed" && data.payload?.widgetPublicKey) {
      void bootstrap(widgetHost, data.payload.widgetPublicKey)
        .then((boot) => {
          if (!activeIframe?.contentWindow) {
            return;
          }

          postInitMessage(activeIframe, widgetHost, {
            widgetPublicKey: boot.widgetPublicKey,
            config: boot.config,
            embedToken: boot.embedToken,
            embedTokenExpiresAt: boot.embedTokenExpiresAt,
            parentOrigin: window.location.origin,
          });
        })
        .catch(() => {
          console.warn("[Site Chat] Failed to refresh embed token.");
        });
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

export { bootstrap, mount, WIDGET_MOUNTED_KEY };
