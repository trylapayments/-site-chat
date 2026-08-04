const IFRAME_PATH = "/widget/embed";
const MESSAGE_SOURCE = "sitechat-loader";

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
  const iframe = createIframe(widgetHost);
  document.body.appendChild(iframe);

  let initialized = false;

  window.addEventListener("message", (event) => {
    if (event.origin !== widgetHost) {
      return;
    }

    const data = event.data as { source?: string; type?: string };
    if (data.source !== "sitechat-embed" || data.type !== "sitechat:ready") {
      return;
    }

    if (initialized) {
      return;
    }

    initialized = true;

    void bootstrap(widgetHost, widgetPublicKey)
      .then((data) => {
        postInitMessage(iframe, widgetHost, {
          widgetPublicKey: data.widgetPublicKey,
          config: data.config,
          embedToken: data.embedToken,
          embedTokenExpiresAt: data.embedTokenExpiresAt,
          parentOrigin: window.location.origin,
        });
      })
      .catch(() => {
        console.warn("[Site Chat] Failed to initialize widget.");
      });
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== widgetHost) {
      return;
    }

    const data = event.data as { source?: string; type?: string; payload?: { open?: boolean } };
    if (data.source !== "sitechat-embed") {
      return;
    }

    if (data.type === "sitechat:visibility") {
      iframe.style.display = data.payload?.open ? "block" : "none";
      iframe.setAttribute("aria-hidden", data.payload?.open ? "false" : "true");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

export {};
